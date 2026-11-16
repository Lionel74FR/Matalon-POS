# Matalon POS - impression réseau des dalles (additions sur l'Oxhoo de la salle du Chardon).
#
# Pont local entre la caisse ouverte dans Chrome sur cette dalle et une imprimante réseau ESC/POS :
# la caisse lui passe le ticket déjà mis en forme, il l'envoie à l'imprimante (port 9100). Chrome ne
# sait pas ouvrir cette connexion lui-même.
#
# Sûreté : n'écoute que sur cet ordinateur (127.0.0.1, port 9181) ; n'accepte que les pages de
# matalon-pos.app ; n'écrit que vers une adresse du réseau local (10.x, 172.16-31.x, 192.168.x),
# ports 9100 à 9109. Ne lit rien et ne garde rien.
#
# Installation : clic droit sur ce fichier, « Exécuter avec PowerShell ». Il se copie dans
# %LOCALAPPDATA%\MatalonPOS, se relance à chaque ouverture de session Windows, et démarre.
# Désinstallation : supprimer « Matalon POS - imprimante reseau.cmd » du dossier Démarrage
# (Win+R, shell:startup) et le dossier %LOCALAPPDATA%\MatalonPOS, puis redémarrer.
param([switch]$Service)

$Port = 9181
$Version = 1
$Origines = '^(https://([a-z0-9-]+\.)*matalon-pos\.app|https://(matalon-pos|moka-caisse)[a-z0-9-]*\.vercel\.app|http://localhost(:\d+)?)$'

if (-not $Service) {
  $Dossier = Join-Path $env:LOCALAPPDATA 'MatalonPOS'
  $Cible = Join-Path $Dossier 'matalon-imprimante-reseau.ps1'
  New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
  if ($PSCommandPath -ne $Cible) { Copy-Item -LiteralPath $PSCommandPath -Destination $Cible -Force }
  Unblock-File -LiteralPath $Cible -ErrorAction SilentlyContinue
  $Lanceur = Join-Path ([Environment]::GetFolderPath('Startup')) 'Matalon POS - imprimante reseau.cmd'
  $Commande = '@start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\MatalonPOS\matalon-imprimante-reseau.ps1" -Service'
  Set-Content -LiteralPath $Lanceur -Value $Commande -Encoding ASCII
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"' + $Cible + '"'), '-Service')
  Write-Host ''
  Write-Host 'Matalon POS : impression reseau installee et demarree.'
  Write-Host 'Elle se relancera a chaque ouverture de session Windows.'
  Write-Host 'Dans la caisse : Reglages > Imprimante des additions > Verifier le script.'
  Start-Sleep -Seconds 6
  exit 0
}

function Test-AdresseLocale([string]$Adresse) {
  if ($Adresse -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $false }
  $o = @($Adresse.Split('.') | ForEach-Object { [int]$_ })
  if (@($o | Where-Object { $_ -gt 255 }).Count -gt 0) { return $false }
  return ($o[0] -eq 10) -or ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) -or ($o[0] -eq 192 -and $o[1] -eq 168)
}

function Send-Reponse($Flux, [int]$Code, [string]$Raison, [string]$Origine, [string]$Json) {
  $corps = [Text.Encoding]::UTF8.GetBytes($Json)
  $entetes = "HTTP/1.1 $Code $Raison`r`nContent-Type: application/json`r`nContent-Length: $($corps.Length)`r`nConnection: close`r`n"
  if ($Origine) {
    $entetes += "Access-Control-Allow-Origin: $Origine`r`nVary: Origin`r`n"
    $entetes += "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`n"
    $entetes += "Access-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n"
  }
  $tete = [Text.Encoding]::ASCII.GetBytes($entetes + "`r`n")
  $Flux.Write($tete, 0, $tete.Length)
  if ($corps.Length -gt 0) { $Flux.Write($corps, 0, $corps.Length) }
  $Flux.Flush()
}

function Read-Requete($Flux) {
  $tete = New-Object System.IO.MemoryStream
  $un = New-Object byte[] 1
  $complete = $false
  while ($tete.Length -lt 16384) {
    if ($Flux.Read($un, 0, 1) -le 0) { return $null }
    $tete.WriteByte($un[0])
    $n = [int]$tete.Length
    if ($n -ge 4) {
      $t = $tete.GetBuffer()
      if ($t[$n - 4] -eq 13 -and $t[$n - 3] -eq 10 -and $t[$n - 2] -eq 13 -and $t[$n - 1] -eq 10) { $complete = $true; break }
    }
  }
  if (-not $complete) { return $null }
  $lignes = [Text.Encoding]::ASCII.GetString($tete.ToArray()) -split "`r`n"
  $premiere = $lignes[0].Split(' ')
  if ($premiere.Count -lt 2) { return $null }
  $entetes = @{}
  foreach ($ligne in $lignes) {
    $i = $ligne.IndexOf(':')
    if ($i -gt 0) { $entetes[$ligne.Substring(0, $i).Trim().ToLowerInvariant()] = $ligne.Substring($i + 1).Trim() }
  }
  $longueur = 0
  if ($entetes.ContainsKey('content-length')) { $longueur = [int]$entetes['content-length'] }
  if ($longueur -lt 0 -or $longueur -gt 1048576) { return $null }
  $corps = New-Object byte[] $longueur
  $lu = 0
  while ($lu -lt $longueur) {
    $n = $Flux.Read($corps, $lu, $longueur - $lu)
    if ($n -le 0) { return $null }
    $lu += $n
  }
  return @{ Methode = $premiere[0]; Cible = $premiere[1]; Entetes = $entetes; Corps = $corps }
}

function Get-Message($Erreur) {
  $e = $Erreur.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  return ($e.Message -replace '[\x00-\x1f"\\]', ' ').Trim()
}

$ecoute = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $Port)
try { $ecoute.Start() } catch { exit 0 }  # déjà lancé dans cette session

while ($true) {
  $client = $ecoute.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 10000
    $client.SendTimeout = 10000
    $flux = $client.GetStream()
    $r = Read-Requete $flux
    if ($null -eq $r) { continue }
    $origine = [string]$r.Entetes['origin']
    if ($origine -and $origine -notmatch $Origines) {
      Send-Reponse $flux 403 'Forbidden' '' '{"erreur":"Page non autorisee."}'
      continue
    }
    $morceaux = $r.Cible.Split([char]'?', 2)
    $chemin = $morceaux[0]
    if ($r.Methode -eq 'OPTIONS') {
      Send-Reponse $flux 204 'No Content' $origine ''
      continue
    }
    if ($r.Methode -eq 'GET' -and $chemin -eq '/etat') {
      Send-Reponse $flux 200 'OK' $origine ('{"ok":true,"version":' + $Version + '}')
      continue
    }
    if ($r.Methode -eq 'POST' -and $chemin -eq '/imprimer') {
      $params = @{}
      if ($morceaux.Count -gt 1) {
        foreach ($p in $morceaux[1].Split([char]'&')) {
          $kv = $p.Split([char]'=', 2)
          if ($kv.Count -eq 2) { $params[$kv[0]] = [Uri]::UnescapeDataString($kv[1]) }
        }
      }
      $adresse = [string]$params['ip']
      $portImprimante = 9100
      if ($params['port'] -match '^\d{4}$') { $portImprimante = [int]$params['port'] }
      if (-not (Test-AdresseLocale $adresse) -or $portImprimante -lt 9100 -or $portImprimante -gt 9109) {
        Send-Reponse $flux 400 'Bad Request' $origine '{"erreur":"Adresse du reseau local et port 9100 a 9109 attendus."}'
        continue
      }
      $imprimante = New-Object System.Net.Sockets.TcpClient
      try {
        $connexion = $imprimante.ConnectAsync($adresse, $portImprimante)
        if (-not $connexion.Wait(4000)) { throw "L'imprimante $adresse ne repond pas." }
        $sortie = $imprimante.GetStream()
        $sortie.Write($r.Corps, 0, $r.Corps.Length)
        $sortie.Flush()
        Start-Sleep -Milliseconds 300
        Send-Reponse $flux 200 'OK' $origine '{"ok":true}'
      } catch {
        Send-Reponse $flux 502 'Bad Gateway' $origine ('{"erreur":"' + (Get-Message $_) + '"}')
      } finally {
        $imprimante.Close()
      }
      continue
    }
    Send-Reponse $flux 404 'Not Found' $origine '{"erreur":"Inconnu."}'
  } catch {
    # Requête interrompue : on passe à la suivante.
  } finally {
    $client.Close()
  }
}
