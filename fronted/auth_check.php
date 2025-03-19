<?php
// auth_check.php - Token-Validierung
require_once 'db_config.php';

// Nur POST-Anfragen erlauben
checkRequestMethod('POST');

// JSON-Daten aus dem Request-Body lesen
$data = json_decode(file_get_contents('php://input'), true);

// Daten validieren
if (!isset($data['token'])) {
    sendErrorResponse('Token ist erforderlich');
}

$token = $data['token'];

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Token validieren
    $user_data = validateToken($token);
    
    if (!$user_data) {
        sendErrorResponse('Ungültiger oder abgelaufener Token', 401);
    }
    
    // Benutzerdaten abrufen
    $stmt = $db->prepare("SELECT id, username, coins, active_upgrade_id FROM users WHERE id = :id");
    $stmt->execute(['id' => $user_data['user_id']]);
    $user = $stmt->fetch();
    
    // Gekaufte Upgrades abrufen
    $stmt = $db->prepare("
        SELECT u.* 
        FROM upgrades u
        JOIN user_upgrades uu ON u.id = uu.upgrade_id
        WHERE uu.user_id = :user_id
    ");
    $stmt->execute(['user_id' => $user['id']]);
    $upgrades = $stmt->fetchAll();
    
    // Aktives Upgrade abrufen
    $active_upgrade = null;
    if ($user['active_upgrade_id']) {
        $stmt = $db->prepare("SELECT * FROM upgrades WHERE id = :id");
        $stmt->execute(['id' => $user['active_upgrade_id']]);
        $active_upgrade = $stmt->fetch();
    }
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'username' => $user['username']
        ],
        'coins' => $user['coins'],
        'upgrades' => $upgrades,
        'active_upgrade' => $active_upgrade
    ]);
    
} catch (PDOException $e) {
    error_log("Token-Validierungsfehler: " . $e->getMessage());
    sendErrorResponse('Token-Validierung fehlgeschlagen', 500);
}
?>