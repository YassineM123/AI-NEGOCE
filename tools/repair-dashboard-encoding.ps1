$files = @(
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'centre-bi-negoce\app.js'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'centre-bi-negoce\index.html')
)
$bad = [char]0xFFFD
$pairs = @(
    @("Synth${bad}se", 'Synthèse'), @("Cr${bad}ances", 'Créances'), @("N${bad}GOCE", 'NÉGOCE'),
    @("d${bad}taill${bad}es", 'détaillées'), @("d${bad}taill${bad}", 'détaillé'), @("${bad} commander", 'À commander'),
    @("${bad}tat", 'État'), @("${bad}g${bad}s", 'âgés'), @("Arr${bad}t${bad}", 'Arrêté'), @("Co${bad}t", 'Coût'),
    @("Relev${bad}", 'Relevé'), @("audit${bad}e", 'auditée'), @("audit${bad}", 'audité'),
    @("Donn${bad}es", 'Données'), @("donn${bad}e", 'donnée'), @("d${bad}mo", 'démo'),
    @("d${bad}p${bad}t", 'dépôt'), @("D${bad}p${bad}t", 'Dépôt'), @("D${bad}tail", 'Détail'),
    @("Quantit${bad}", 'Quantité'), @("Agr${bad}gats", 'Agrégats'), @("S${bad}rie", 'Série'),
    @("en-t${bad}te", 'en-tête'), @("m${bad}tiers", 'métiers'), @("m${bad}tier", 'métier'),
    @("calcul${bad}", 'calculé'), @("R${bad}f${bad}rences", 'Références'), @("n${bad}gatives", 'négatives'),
    @("R${bad}serves", 'Réserves'), @("R${bad}serv${bad}", 'Réservé'), @("anciennet${bad}", 'ancienneté'),
    @("r${bad}ellement", 'réellement'), @("M${bad}thode", 'Méthode'), @("${bad}cran", 'Écran'),
    @("${bad}lectroniques", 'électroniques'), @("d${bad}clench${bad}e", 'déclenchée'),
    @("observ${bad}", 'observé'), @("rep${bad}r${bad}s", 'repérés'), @("V${bad}rifi${bad}s", 'Vérifiés'),
    @("v${bad}rifi${bad}", 'vérifié'), @("pseudonymis${bad}es", 'pseudonymisées'),
    @("pseudonymis${bad}s", 'pseudonymisés'), @("recalcul${bad}es", 'recalculées'),
    @("synchronis${bad}s", 'synchronisés'), @("P${bad}rim${bad}tre", 'Périmètre'),
    @("S${bad}lection", 'Sélection'), @("L${bad}extraction", 'L’extraction'), @("l${bad}${bad}tat", 'l’état'),
    @("lorsqu${bad}un", 'lorsqu’un'), @("m${bad}me", 'même'), @("partag${bad}", 'partagé'),
    @("commande${bad}livraison", 'commande–livraison'), @("2026${bad}20", '2026–20'), @("2026${bad}31", '2026–31')
    ,@("s${bad}rie", 'série'), @("d${bad}tail", 'détail'), @('MÃ©thode du coÃ»t Â· certifier', 'Méthode du coût à certifier')
    ,@('l�Ã‰tat Â· Ã€ commander �', 'l’état « À commander »'), @('Â· d�tail', '· détail')
    ,@('synchronisÃ©s', 'synchronisés')
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($file in $files) {
    $text = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
    foreach ($pair in $pairs) { $text = $text.Replace($pair[0], $pair[1]) }
    $text = $text.Replace(" ${bad} ", ' · ').Replace("pseudonymisées${bad}", 'pseudonymisées…')
    [IO.File]::WriteAllText($file, $text, $utf8)
}
