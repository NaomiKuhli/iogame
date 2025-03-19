<?php
// change_password.php - Passwort ändern
require_once 'db_config.php';

// Nur POST-Anfragen erlauben
checkRequestMethod('POST');

// Benutzer aus Token abrufen
$user_data = getUserFromAuthHeader();
if (!$user_data) {
    sendErrorResponse('Nicht autorisiert', 401);
}

// JSON-Daten aus dem Request-Body lesen
$data = json_decode(file_get_contents('php://input'), true);

// Daten validieren
if (!isset($data['current_password']) || !isset($data['new_password'])) {
    sendErrorResponse('Aktuelles und neues Passwort sind erforderlich');
}

$current_password = $data['current_password'];
$new_password = $data['new_password'];

// Neues Passwort validieren
if (strlen($new_password) < 6) {
    sendErrorResponse('Neues Passwort muss mindestens 6 Zeichen lang sein');
}

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Aktuelles Passwort überprüfen
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = :id");
    $stmt->execute(['id' => $user_data['user_id']]);
    $user = $stmt->fetch();
    
    if (!password_verify($current_password, $user['password_hash'])) {
        sendErrorResponse('Aktuelles Passwort ist falsch');
    }
    
    // Neues Passwort hashen
    $new_password_hash = password_hash($new_password, PASSWORD_DEFAULT);
    
    // Passwort aktualisieren
    $stmt = $db->prepare("UPDATE users SET password_hash = :password_hash WHERE id = :id");
    $stmt->execute([
        'password_hash' => $new_password_hash,
        'id' => $user_data['user_id']
    ]);
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'message' => 'Passwort erfolgreich geändert'
    ]);
    
} catch (PDOException $e) {
    error_log("Passwortänderungsfehler: " . $e->getMessage());
    sendErrorResponse('Passwortänderung fehlgeschlagen', 500);
}
?>