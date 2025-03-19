<?php
// login.php - Benutzeranmeldung
require_once 'db_config.php';

// Nur POST-Anfragen erlauben
checkRequestMethod('POST');

// JSON-Daten aus dem Request-Body lesen
$data = json_decode(file_get_contents('php://input'), true);

// Daten validieren
if (!isset($data['username']) || !isset($data['password'])) {
    sendErrorResponse('Benutzername und Passwort sind erforderlich');
}

$username = trim($data['username']);
$password = $data['password'];

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Benutzer in Datenbank suchen
    $stmt = $db->prepare("
        SELECT id, username, password_hash, coins, active_upgrade_id 
        FROM users 
        WHERE username = :username
    ");
    $stmt->execute(['username' => $username]);
    
    if ($stmt->rowCount() === 0) {
        sendErrorResponse('Ungültiger Benutzername oder Passwort');
    }
    
    $user = $stmt->fetch();
    
    // Passwort überprüfen
    if (!password_verify($password, $user['password_hash'])) {
        sendErrorResponse('Ungültiger Benutzername oder Passwort');
    }
    
    // Token generieren
    $token = generateToken($user['id']);
    if (!$token) {
        sendErrorResponse('Fehler bei der Token-Generierung', 500);
    }
    
    // Letzte Anmeldung aktualisieren
    $stmt = $db->prepare("UPDATE users SET last_login = NOW() WHERE id = :id");
    $stmt->execute(['id' => $user['id']]);
    
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
        'token' => $token,
        'user' => [
            'id' => $user['id'],
            'username' => $user['username']
        ],
        'coins' => $user['coins'],
        'upgrades' => $upgrades,
        'active_upgrade' => $active_upgrade
    ]);
    
} catch (PDOException $e) {
    error_log("Anmeldefehler: " . $e->getMessage());
    sendErrorResponse('Anmeldung fehlgeschlagen', 500);
}
?>