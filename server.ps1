$ErrorActionPreference = "Stop"

$root = (Resolve-Path $PSScriptRoot).Path
$rooms = @{}
$port = 8000
$roomTtlSeconds = 180
$validInputs = @("left", "right", "jump", "attack", "skill", "hook", "decoy", "restart")
$utf8 = [System.Text.UTF8Encoding]::new($false)
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)

function Send-HttpResponse($stream, [int]$status, [string]$contentType, [byte[]]$body) {
  $reason = switch ($status) {
    200 { "OK" }
    201 { "Created" }
    202 { "Accepted" }
    400 { "Bad Request" }
    404 { "Not Found" }
    409 { "Conflict" }
    413 { "Payload Too Large" }
    429 { "Too Many Requests" }
    default { "Internal Server Error" }
  }
  $headers = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nPragma: no-cache`r`nExpires: 0`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($body.Length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
  $stream.Flush()
}

function Send-JsonResponse($stream, [int]$status, $payload) {
  $json = ConvertTo-Json -InputObject $payload -Depth 100 -Compress
  $body = $utf8.GetBytes($json)
  Send-HttpResponse $stream $status "application/json; charset=utf-8" $body
}

function New-RoomCode {
  do {
    $code = -join (1..6 | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
  } while ($rooms.ContainsKey($code))
  return $code
}

function Remove-ExpiredRooms {
  $now = [DateTime]::UtcNow
  foreach ($code in @($rooms.Keys)) {
    if (($now - $rooms[$code].lastSeen).TotalSeconds -gt $roomTtlSeconds) {
      $rooms.Remove($code)
    }
  }
}

function Test-RoomCode([string]$code) {
  return $code -match '^[0-9]{6}$'
}

function Get-RequestHeader($stream) {
  $bytes = [System.Collections.Generic.List[byte]]::new()
  $matched = 0
  $ending = @(13, 10, 13, 10)
  while ($bytes.Count -lt 16384) {
    $value = $stream.ReadByte()
    if ($value -lt 0) { break }
    $bytes.Add([byte]$value)
    if ($value -eq $ending[$matched]) {
      $matched += 1
      if ($matched -eq $ending.Length) { break }
    } else {
      $matched = if ($value -eq 13) { 1 } else { 0 }
    }
  }
  if ($matched -ne $ending.Length) {
    throw "Invalid or oversized HTTP request header."
  }
  return [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
}

function Invoke-Request($stream, [string]$method, [string]$target, [hashtable]$headers) {
  $uri = [Uri]::new("http://localhost$target")
  $path = [Uri]::UnescapeDataString($uri.AbsolutePath)
  $payload = $null

  if ($method -eq "POST") {
    $length = 0
    if ($headers.ContainsKey("content-length")) {
      if (-not [int]::TryParse($headers["content-length"], [ref]$length)) {
        Send-JsonResponse $stream 400 @{ error = "無效的請求內容長度。" }
        return
      }
    }
    if ($length -le 0 -or $length -gt 524288) {
      Send-JsonResponse $stream 413 @{ error = "請求內容為空或超過大小限制。" }
      return
    }
    $bodyBytes = [byte[]]::new($length)
    $offset = 0
    while ($offset -lt $length) {
      $read = $stream.Read($bodyBytes, $offset, $length - $offset)
      if ($read -le 0) { throw "Incomplete HTTP request body." }
      $offset += $read
    }
    try {
      $payload = ConvertFrom-Json -InputObject $utf8.GetString($bodyBytes)
      if ($null -eq $payload -or $payload -is [Array]) { throw "Invalid request object." }
    } catch {
      Send-JsonResponse $stream 400 @{ error = "請求內容不是有效的 JSON 物件。" }
      return
    }
  }

  Remove-ExpiredRooms

  if ($method -eq "POST" -and $path -eq "/api/rooms") {
    $code = New-RoomCode
    $rooms[$code] = @{
      guest = $false
      snapshot = $null
      inputs = (New-Object System.Collections.ArrayList)
      lastSeen = [DateTime]::UtcNow
    }
    Send-JsonResponse $stream 201 @{ roomCode = $code }
    return
  }

  if ($method -eq "GET" -and $path -eq "/api/poll") {
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    $code = $query["roomCode"]
    $role = $query["role"]
    if (-not (Test-RoomCode $code) -or $role -notin @("host", "guest")) {
      Send-JsonResponse $stream 400 @{ error = "房號或玩家身分無效。" }
      return
    }
    if (-not $rooms.ContainsKey($code)) {
      Send-JsonResponse $stream 404 @{ error = "找不到房間，房間可能已關閉。" }
      return
    }
    $room = $rooms[$code]
    $room.lastSeen = [DateTime]::UtcNow
    if ($role -eq "guest" -and -not $room.guest) {
      Send-JsonResponse $stream 404 @{ error = "房主已離開房間。" }
      return
    }
    if ($role -eq "host") {
      $inputs = @($room.inputs.ToArray())
      $room.inputs.Clear()
      Send-JsonResponse $stream 200 @{ connected = [bool]$room.guest; inputs = $inputs }
    } else {
      Send-JsonResponse $stream 200 @{ connected = $true; snapshot = $room.snapshot }
    }
    return
  }

  if ($method -ne "POST") {
    if ($path.StartsWith("/api/")) {
      Send-JsonResponse $stream 404 @{ error = "找不到此 API。" }
      return
    }
    if ($path -eq "/") { $path = "/index.html" }
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart("/") -replace "/", "\")))
    if (-not $filePath.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      Send-JsonResponse $stream 404 @{ error = "找不到此檔案。" }
      return
    }
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
      Send-JsonResponse $stream 404 @{ error = "找不到此檔案。" }
      return
    }
    $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
    $contentType = switch ($extension) {
      ".html" { "text/html; charset=utf-8" }
      ".js" { "application/javascript; charset=utf-8" }
      ".css" { "text/css; charset=utf-8" }
      ".json" { "application/json; charset=utf-8" }
      default { "application/octet-stream" }
    }
    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
    Send-HttpResponse $stream 200 $contentType $fileBytes
    return
  }

  $code = [string]$payload.roomCode
  if (-not (Test-RoomCode $code)) {
    Send-JsonResponse $stream 400 @{ error = "請提供有效的 6 位數房號。" }
    return
  }

  if ($path -eq "/api/rooms/join") {
    if (-not $rooms.ContainsKey($code)) {
      Send-JsonResponse $stream 404 @{ error = "找不到此房間，請確認房號。" }
      return
    }
    $room = $rooms[$code]
    if ($room.guest) {
      Send-JsonResponse $stream 409 @{ error = "此房間已有玩家。" }
      return
    }
    $room.guest = $true
    $room.lastSeen = [DateTime]::UtcNow
    Send-JsonResponse $stream 200 @{ joined = $true }
    return
  }

  if (-not $rooms.ContainsKey($code)) {
    Send-JsonResponse $stream 404 @{ error = "找不到房間，房間可能已關閉。" }
    return
  }
  $room = $rooms[$code]
  $room.lastSeen = [DateTime]::UtcNow

  if ($path -eq "/api/input") {
    $action = [string]$payload.action
    if (-not $room.guest) {
      Send-JsonResponse $stream 409 @{ error = "房間尚未有第二位玩家加入。" }
      return
    }
    if ($action -notin $validInputs -or $payload.pressed -isnot [bool]) {
      Send-JsonResponse $stream 400 @{ error = "玩家操作內容無效。" }
      return
    }
    if ($room.inputs.Count -ge 1000) {
      Send-JsonResponse $stream 429 @{ error = "操作佇列已滿，請稍後再試。" }
      return
    }
    [void]$room.inputs.Add(@{ action = $action; pressed = $payload.pressed })
    Send-JsonResponse $stream 202 @{ accepted = $true }
    return
  }

  if ($path -eq "/api/state") {
    if (-not $room.guest) {
      Send-JsonResponse $stream 409 @{ error = "對手尚未連線，無法同步遊戲狀態。" }
      return
    }
    if ($null -eq $payload.snapshot -or $payload.snapshot -isnot [System.Management.Automation.PSCustomObject]) {
      Send-JsonResponse $stream 400 @{ error = "遊戲狀態格式錯誤。" }
      return
    }
    $room.snapshot = $payload.snapshot
    Send-JsonResponse $stream 202 @{ synced = $true }
    return
  }

  if ($path -eq "/api/rooms/leave") {
    if ($payload.role -eq "host") {
      $rooms.Remove($code)
    } elseif ($payload.role -eq "guest") {
      $room.guest = $false
      $room.snapshot = $null
      $room.inputs.Clear()
    } else {
      Send-JsonResponse $stream 400 @{ error = "玩家身分無效。" }
      return
    }
    Send-JsonResponse $stream 200 @{ left = $true }
    return
  }

  Send-JsonResponse $stream 404 @{ error = "找不到此 API。" }
}

try {
  $listener.Start()
  Write-Host "Fight server is running at http://localhost:$port"
  Write-Host "Other players can connect using this computer's network IP and port $port."
  Write-Host "Press Ctrl+C to stop the server."
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $null
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 10000
      $headerText = Get-RequestHeader $stream
      $lines = $headerText -split "`r`n"
      $requestLine = $lines[0] -split " "
      if ($requestLine.Length -lt 2) { throw "Invalid HTTP request line." }
      $headers = @{}
      foreach ($line in $lines | Select-Object -Skip 1) {
        $separator = $line.IndexOf(":")
        if ($separator -gt 0) {
          $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] = $line.Substring($separator + 1).Trim()
        }
      }
      Invoke-Request $stream $requestLine[0].ToUpperInvariant() $requestLine[1] $headers
    } catch {
      Write-Warning $_.Exception.Message
      try {
        $errorBody = $utf8.GetBytes('{"error":"伺服器處理請求時發生錯誤。"}')
        Send-HttpResponse $stream 500 "application/json; charset=utf-8" $errorBody
      } catch {}
    } finally {
      if ($stream) { $stream.Dispose() }
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
