<?php
// register.php - Benutzerregistrierung
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

// Benutzernamen validieren
if (strlen($username) < 3 || strlen($username) > 20) {
    sendErrorResponse('Benutzername muss zwischen 3 und 20 Zeichen lang sein');
}

if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
    sendErrorResponse('Benutzername darf nur Buchstaben, Zahlen und Unterstriche enthalten');
}

// Passwort validieren
if (strlen($password) < 6) {
    sendErrorResponse('Passwort muss mindestens 6 Zeichen lang sein');
}

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Prüfen, ob Benutzername bereits existiert
    $stmt = $db->prepare("SELECT id FROM users WHERE username = :username");
    $stmt->execute(['username' => $username]);
    
    if ($stmt->rowCount() > 0) {
        sendErrorResponse('Benutzername bereits vergeben');
    }
    
    // Passwort hashen
    $password_hash = password_hash($password, PASSWORD_DEFAULT);
    
    // Benutzer in Datenbank einfügen
    $stmt = $db->prepare("
        INSERT INTO users (username, password_hash) 
        VALUES (:username, :password_hash)
    ");
    
    $stmt->execute([
        'username' => $username,
        'password_hash' => $password_hash
    ]);
    
    $user_id = $db->lastInsertId();
    
    // User-Stats-Eintrag erstellen
    $stmt = $db->prepare("INSERT INTO user_stats (user_id) VALUES (:user_id)");
    $stmt->execute(['user_id' => $user_id]);
    
    // Erfolgsantwort senden
    http_response_code(201); // Created
    echo json_encode([
        'success' => true,
        'message' => 'Registrierung erfolgreich'
    ]);
    
} catch (PDOException $e) {
    error_log("Registrierungsfehler: " . $e->getMessage());
    sendErrorResponse('Registrierung fehlgeschlagen', 500);
}
?>