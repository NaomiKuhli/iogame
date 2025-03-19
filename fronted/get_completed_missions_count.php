<?php
// Holen des Tokens (entweder aus URL-Parameter oder aus dem Body)
$token = '';

// 1. Aus URL-Parameter
if (isset($_GET['token'])) {
    $token = $_GET['token'];
}
// 2. Aus dem Request-Body (für POST-Anfragen)
else {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['token'])) {
        $token = $data['token'];
    }
}
// 3. Aus dem Authorization-Header (fallback)
if (empty($token)) {
    $headers = getallheaders();
    if (isset($headers['Authorization'])) {
        if (preg_match('/Bearer\s+(.*)$/i', $headers['Authorization'], $matches)) {
            $token = $matches[1];
        }
    }
}

// Token validieren
if (empty($token)) {
    // Kein Token gefunden
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Nicht autorisiert: Token fehlt'
    ]);
    exit;
}

$user_data = validateToken($token);
if (!$user_data) {
    // Ungültiger Token
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Nicht autorisiert: Ungültiger oder abgelaufener Token'
    ]);
    exit;
}

// get_completed_missions_count.php - Anzahl abgeschlossener Missionen abrufen
require_once 'db_config.php';

// Nur GET-Anfragen erlauben
checkRequestMethod('GET');

// Benutzer aus Token abrufen
$user_data = getUserFromAuthHeader();
if (!$user_data) {
    sendErrorResponse('Nicht autorisiert', 401);
}

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Anzahl der abgeschlossenen Missionen abrufen
    $stmt = $db->prepare("
        SELECT COUNT(*) as count
        FROM user_missions
        WHERE user_id = :user_id AND claimed = 1
    ");
    $stmt->execute(['user_id' => $user_data['user_id']]);
    $result = $stmt->fetch();
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'count' => $result['count']
    ]);
    
} catch (PDOException $e) {
    error_log("Fehler beim Abrufen der abgeschlossenen Missionen: " . $e->getMessage());
    sendErrorResponse('Fehler beim Abrufen der abgeschlossenen Missionen', 500);
}
?>