<?php
header('Access-Control-Allow-Origin: https://iogame-zelo.onrender.com');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// check_admin_status.php - Prüft, ob ein Benutzer Admin-Rechte hat
require_once 'db_config.php';

// Nur GET-Anfragen erlauben
checkRequestMethod('GET');

// Token aus Query-Parameter holen
$token = '';
if (isset($_GET['token'])) {
    $token = $_GET['token'];
}

// Token validieren
if (!$token) {
    sendErrorResponse('Token ist erforderlich', 401);
}

$user_data = validateToken($token);
if (!$user_data) {
    sendErrorResponse('Ungültiger oder abgelaufener Token', 401);
}

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Admin-Status des Benutzers prüfen
    $stmt = $db->prepare("
        SELECT is_admin 
        FROM users 
        WHERE id = :user_id
    ");
    $stmt->execute(['user_id' => $user_data['user_id']]);
    
    if ($stmt->rowCount() === 0) {
        sendErrorResponse('Benutzer nicht gefunden', 404);
    }
    
    $user = $stmt->fetch();
    $is_admin = (bool)$user['is_admin'];
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'is_admin' => $is_admin
    ]);
    
} catch (PDOException $e) {
    error_log("Fehler bei der Admin-Status-Prüfung: " . $e->getMessage());
    sendErrorResponse('Fehler bei der Admin-Status-Prüfung', 500);
}
?>