param(
  [Parameter(Mandatory = $true)]
  [string] $Root,
  [int] $Port = 8765,
  [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'

# This server is intentionally local-only. The limits below keep a malformed
# localhost request from holding a PowerShell process or large response open.
$MaxRequestBytes = 16384
$MaxHeaderLineBytes = 4096
$MaxResponseBytes = 64 * 1024 * 1024
$MaxClients = 8
$ClientTtlSeconds = 75
$ClientCleanupIntervalSeconds = 10

function ConvertFrom-Utf8Base64 {
  param([string] $Value)
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function Show-StartupChoice {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $form = New-Object System.Windows.Forms.Form
  $form.Text = ConvertFrom-Utf8Base64 '5YiG6ZWc5omT5YyF5Zmo'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ClientSize = New-Object System.Drawing.Size(460, 184)
  $form.Tag = 'cancel'

  $heading = New-Object System.Windows.Forms.Label
  $heading.Text = ConvertFrom-Utf8Base64 '6YCJ5oup5ZCv5Yqo5pa55byP'
  $heading.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Bold)
  $heading.AutoSize = $true
  $heading.Location = New-Object System.Drawing.Point(24, 22)
  $form.Controls.Add($heading)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = ConvertFrom-Utf8Base64 '5oGi5aSN5LiK5LiA5qyh5Lya5omT5byA5pyA6L+R5L+d5a2Y55qE57yW5o6S77yb5paw5bu657yW5o6S5Lya5LuO56m655m95byA5aeL44CC'
  $description.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $description.AutoSize = $true
  $description.Location = New-Object System.Drawing.Point(25, 62)
  $form.Controls.Add($description)

  $newButton = New-Object System.Windows.Forms.Button
  $newButton.Text = ConvertFrom-Utf8Base64 '5paw5bu657yW5o6S'
  $newButton.Size = New-Object System.Drawing.Size(116, 38)
  $newButton.Location = New-Object System.Drawing.Point(24, 112)
  $newButton.Add_Click({ $form.Tag = 'new'; $form.Close() })
  $form.Controls.Add($newButton)

  $resumeButton = New-Object System.Windows.Forms.Button
  $resumeButton.Text = ConvertFrom-Utf8Base64 '5oGi5aSN5LiK5LiA5qyh'
  $resumeButton.Size = New-Object System.Drawing.Size(132, 38)
  $resumeButton.Location = New-Object System.Drawing.Point(152, 112)
  $resumeButton.Add_Click({ $form.Tag = 'resume'; $form.Close() })
  $form.Controls.Add($resumeButton)

  $cancelButton = New-Object System.Windows.Forms.Button
  $cancelButton.Text = ConvertFrom-Utf8Base64 '5Y+W5raI5ZCv5Yqo'
  $cancelButton.Size = New-Object System.Drawing.Size(116, 38)
  $cancelButton.Location = New-Object System.Drawing.Point(296, 112)
  $cancelButton.Add_Click({ $form.Tag = 'cancel'; $form.Close() })
  $form.Controls.Add($cancelButton)

  $form.AcceptButton = $newButton
  $form.CancelButton = $cancelButton
  [void] $form.ShowDialog()
  return [string] $form.Tag
}

function Read-HttpRequest {
  param([System.Net.Sockets.NetworkStream] $Stream)
  $buffer = New-Object byte[] 2048
  $bytes = New-Object 'System.Collections.Generic.List[byte]'
  while ($bytes.Count -lt $MaxRequestBytes) {
    $read = $Stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { break }
    for ($index = 0; $index -lt $read; $index += 1) {
      $bytes.Add($buffer[$index])
    }
    $text = [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
    $headerEnd = $text.IndexOf("`r`n`r`n", [System.StringComparison]::Ordinal)
    if ($headerEnd -ge 0) {
      if ($headerEnd + 4 -gt $MaxRequestBytes) { throw 'RequestTooLarge' }
      return $text.Substring(0, $headerEnd + 4)
    }
  }
  throw 'RequestTooLarge'
}

function Get-RequestHeaders {
  param([string] $RequestText)
  $lines = $RequestText -split "`r?`n"
  $headers = @{}
  for ($index = 1; $index -lt $lines.Length; $index += 1) {
    $line = $lines[$index]
    if ([string]::IsNullOrEmpty($line)) { break }
    if ($line.Length -gt $MaxHeaderLineBytes) { throw 'HeaderTooLarge' }
    $separator = $line.IndexOf(':')
    if ($separator -le 0) { throw 'BadHeader' }
    $name = $line.Substring(0, $separator).Trim().ToLowerInvariant()
    $value = $line.Substring($separator + 1).Trim()
    if ($name -notmatch '^[a-z0-9-]{1,64}$' -or $value.Length -gt 2048) {
      throw 'BadHeader'
    }
    if ($headers.ContainsKey($name)) { throw 'DuplicateHeader' }
    $headers[$name] = $value
  }
  return $headers
}

function Test-AllowedHost {
  param([hashtable] $Headers)
  if (-not $Headers.ContainsKey('host')) { return $false }
  $allowed = @(
    "127.0.0.1:$Port",
    "localhost:$Port",
    '127.0.0.1',
    'localhost'
  )
  return $allowed -contains $Headers['host'].ToLowerInvariant()
}

function Test-AllowedOrigin {
  param([hashtable] $Headers)
  if ($Headers.ContainsKey('sec-fetch-site') -and $Headers['sec-fetch-site'] -notin @('same-origin', 'none')) { return $false }
  if (-not $Headers.ContainsKey('origin')) { return $true }
  $allowed = @("http://127.0.0.1:$Port", "http://localhost:$Port")
  return $allowed -contains $Headers['origin']
}

try {
  $rootPath = (Resolve-Path -LiteralPath $Root).Path
  $indexPath = Join-Path $rootPath 'index.html'
  if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    throw "Static home page not found: $indexPath"
  }
} catch {
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$baseUrl = "http://127.0.0.1:$Port/"
$startupMode = 'new'
if (-not $NoBrowser) {
  try {
    $startupMode = Show-StartupChoice
  } catch {
    Write-Host '[WARNING] Startup choice window could not open; starting a new project.' -ForegroundColor Yellow
    $startupMode = 'new'
  }
  if ($startupMode -eq 'cancel') { exit 0 }
}
$startUrl = "${baseUrl}?startup=$startupMode"

$listener = $null
try {
  $ipAddress = [System.Net.IPAddress]::Parse('127.0.0.1')
  $listener = New-Object -TypeName System.Net.Sockets.TcpListener -ArgumentList @($ipAddress, $Port)
  $listener.Start()
} catch {
  if ($null -ne $listener) { $listener.Stop() }
  try {
    $existing = Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -TimeoutSec 2
    if ($existing.StatusCode -eq 200 -and $existing.Content -like '*storyboard-packager*') {
      Write-Host "An existing storyboard packager is already running at $baseUrl" -ForegroundColor Cyan
      if (-not $NoBrowser) { Start-Process $startUrl }
      exit 0
    }
  } catch {
    # The port may simply be closed while another process owns the socket.
  }
  Write-Host "[ERROR] Port $Port is unavailable. Close the program using it and retry." -ForegroundColor Red
  exit 1
}

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.mjs' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.mp4' = 'video/mp4'
  '.webm' = 'video/webm'
}

$activeClients = @{}
$shutdownAt = [DateTime]::UtcNow.AddSeconds(90)
$nextClientCleanup = [DateTime]::UtcNow.AddSeconds($ClientCleanupIntervalSeconds)
$shutdownDelaySeconds = 4

function Remove-StaleClients {
  $now = [DateTime]::UtcNow
  foreach ($clientId in @($activeClients.Keys)) {
    if (($now - $activeClients[$clientId]).TotalSeconds -gt $ClientTtlSeconds) {
      $activeClients.Remove($clientId)
    }
  }
  if ($activeClients.Count -eq 0 -and $null -eq $script:shutdownAt) {
    $script:shutdownAt = $now.AddSeconds($shutdownDelaySeconds)
  }
}

function Send-RawResponse {
  param(
    [System.Net.Sockets.NetworkStream] $Stream,
    [int] $StatusCode,
    [string] $StatusText,
    [byte[]] $Body,
    [string] $ContentType,
    [bool] $HeadOnly
  )
  if ($Body.Length -gt $MaxResponseBytes) { throw 'ResponseTooLarge' }
  $header = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nX-Frame-Options: DENY`r`nReferrer-Policy: no-referrer`r`nPermissions-Policy: camera=(), microphone=(), geolocation=()`r`nCross-Origin-Resource-Policy: same-origin`r`nContent-Security-Policy: default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.WriteTimeout = 5000
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Send-TextError {
  param(
    [System.Net.Sockets.NetworkStream] $Stream,
    [int] $StatusCode,
    [string] $StatusText,
    [string] $Message
  )
  $body = [System.Text.Encoding]::UTF8.GetBytes($Message)
  Send-RawResponse -Stream $Stream -StatusCode $StatusCode -StatusText $StatusText -Body $body -ContentType 'text/plain; charset=utf-8' -HeadOnly $false
}

Write-Host "Storyboard packager is running at $baseUrl" -ForegroundColor Cyan
Write-Host 'Files stay in the browser; press Ctrl+C to stop.' -ForegroundColor DarkGray
if (-not $NoBrowser) { Start-Process $startUrl }

try {
  while ($listener.Server.IsBound) {
    if ([DateTime]::UtcNow -ge $nextClientCleanup) {
      Remove-StaleClients
      $nextClientCleanup = [DateTime]::UtcNow.AddSeconds($ClientCleanupIntervalSeconds)
    }
    if ($activeClients.Count -eq 0 -and $null -ne $shutdownAt -and [DateTime]::UtcNow -ge $shutdownAt) {
      Write-Host 'The webpage was closed. Stopping the local server...' -ForegroundColor DarkGray
      break
    }
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 100
      continue
    }

    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    try {
      $stream.ReadTimeout = 5000
      $stream.WriteTimeout = 5000
      $requestText = Read-HttpRequest -Stream $stream
      $requestLine = ($requestText -split "`r?`n")[0]
      if ($requestLine.Length -gt 2048) { throw 'RequestTooLarge' }
      $parts = $requestLine.Split(' ')
      if ($parts.Length -ne 3) { throw 'BadRequest' }
      $method = $parts[0].ToUpperInvariant()
      $target = $parts[1]
      $version = $parts[2].ToUpperInvariant()
      if ($version -ne 'HTTP/1.0' -and $version -ne 'HTTP/1.1') { throw 'BadRequest' }
      if ($target.Length -gt 2048) { throw 'RequestTooLarge' }
      $headers = Get-RequestHeaders -RequestText $requestText
      if (-not (Test-AllowedHost -Headers $headers) -or -not (Test-AllowedOrigin -Headers $headers)) {
        Send-TextError -Stream $stream -StatusCode 403 -StatusText 'Forbidden' -Message 'Forbidden'
        continue
      }
      if ($headers.ContainsKey('transfer-encoding')) {
        Send-TextError -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Message 'Transfer encoding is not accepted'
        continue
      }
      if ($headers.ContainsKey('content-length')) {
        $contentLength = 0L
        if ($headers.ContainsKey('transfer-encoding') -or -not [Int64]::TryParse($headers['content-length'], [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$contentLength) -or $contentLength -ne 0) {
          Send-TextError -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Message 'Request body is not accepted'
          continue
        }
      }

      $targetUri = New-Object -TypeName System.Uri -ArgumentList @("http://127.0.0.1$target")
      $clientIdPart = $targetUri.Query.TrimStart('?').Split('&') | Where-Object { $_ -like 'id=*' } | Select-Object -First 1
      $clientId = if ($null -ne $clientIdPart) { [System.Uri]::UnescapeDataString($clientIdPart.Substring(3)) } else { '' }

      if ($targetUri.AbsolutePath -eq '/__client-open' -or $targetUri.AbsolutePath -eq '/__client-heartbeat') {
        if ($method -ne 'GET' -or $clientId -notmatch '^[A-Za-z0-9-]{8,80}$') {
          Send-TextError -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Message 'Bad request'
          continue
        }
        if (-not $activeClients.ContainsKey($clientId) -and $activeClients.Count -ge $MaxClients) {
          Send-TextError -Stream $stream -StatusCode 429 -StatusText 'Too Many Requests' -Message 'Too many local clients'
          continue
        }
        $activeClients[$clientId] = [DateTime]::UtcNow
        $shutdownAt = $null
        Send-RawResponse -Stream $stream -StatusCode 200 -StatusText 'OK' -Body ([System.Text.Encoding]::UTF8.GetBytes('ok')) -ContentType 'text/plain; charset=utf-8' -HeadOnly $false
        continue
      }

      if ($targetUri.AbsolutePath -eq '/__client-closed') {
        if ($method -ne 'POST' -or $clientId -notmatch '^[A-Za-z0-9-]{8,80}$') {
          Send-TextError -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Message 'Bad request'
          continue
        }
        $activeClients.Remove($clientId)
        if ($activeClients.Count -eq 0) { $shutdownAt = [DateTime]::UtcNow.AddSeconds($shutdownDelaySeconds) }
        Send-RawResponse -Stream $stream -StatusCode 204 -StatusText 'No Content' -Body ([byte[]]@()) -ContentType 'text/plain; charset=utf-8' -HeadOnly $false
        continue
      }

      if ($method -ne 'GET' -and $method -ne 'HEAD') {
        Send-TextError -Stream $stream -StatusCode 405 -StatusText 'Method Not Allowed' -Message 'Method not allowed'
        continue
      }

      $relativePath = [System.Uri]::UnescapeDataString($targetUri.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
      if ($relativePath.Length -gt 2048 -or $relativePath -like '*..*' -or $relativePath.IndexOf([char]0) -ge 0) {
        Send-TextError -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Message 'Bad request'
        continue
      }

      $candidatePath = Join-Path $rootPath ($relativePath -replace '/', '\')
      $fullPath = [System.IO.Path]::GetFullPath($candidatePath)
      $rootWithSeparator = $rootPath.TrimEnd('\') + '\'
      $isInsideRoot = $fullPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase) -or $fullPath.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase)
      if (-not $isInsideRoot) {
        Send-TextError -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Message 'Bad request'
        continue
      }

      if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        if (($method -eq 'GET') -and ($targetUri.AbsolutePath -notmatch '\.')) {
          $fullPath = $indexPath
        } else {
          Send-TextError -Stream $stream -StatusCode 404 -StatusText 'Not Found' -Message 'Not found'
          continue
        }
      }
      $fileInfo = Get-Item -LiteralPath $fullPath
      if ($fileInfo.Length -gt $MaxResponseBytes) {
        Send-TextError -Stream $stream -StatusCode 413 -StatusText 'Payload Too Large' -Message 'Response is too large'
        continue
      }
      $body = [System.IO.File]::ReadAllBytes($fullPath)
      $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
      $contentType = 'application/octet-stream'
      if ($mimeTypes.ContainsKey($extension)) { $contentType = $mimeTypes[$extension] }
      Send-RawResponse -Stream $stream -StatusCode 200 -StatusText 'OK' -Body $body -ContentType $contentType -HeadOnly ($method -eq 'HEAD')
    } catch {
      try {
        $status = if ($_.Exception.Message -eq 'RequestTooLarge' -or $_.Exception.Message -eq 'HeaderTooLarge') { 431 } else { 400 }
        $statusText = if ($status -eq 431) { 'Request Header Fields Too Large' } else { 'Bad Request' }
        Send-TextError -Stream $stream -StatusCode $status -StatusText $statusText -Message 'Bad request'
      } catch {
        # The client may have closed the connection before the error response.
      }
    } finally {
      $stream.Close()
      $client.Close()
    }
  }
} finally {
  if ($null -ne $listener) { $listener.Stop() }
}
