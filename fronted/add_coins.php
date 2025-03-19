<?php
// add_coins.php - Coins zum Benutzerkonto hinzufügen
require_once 'db_config.php';

// Nur POST-Anfragen erlauben
checkRequestMethod('POST');

// Token aus Query-Parameter oder Request-Body holen
$token = '';
if (isset($_GET['token'])) {
    $token = $_GET['token'];
} else {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['token'])) {
        $token = $data['token'];
    }
}

// Token validieren
if (!$token) {
    sendErrorResponse('Token ist erforderlich', 401);
}

$user_data = validateToken($token);
if (!$user_data) {
    sendErrorResponse('Ungültiger oder abgelaufener Token', 401);
}

// Daten aus dem Request-Body oder Query-Parametern lesen
$coins = 0;
$reason = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['coins'])) {
        $coins = (int)$data['coins'];
    }
    if (isset($data['reason'])) {
        $reason = $data['reason'];
    }
} else {
    if (isset($_GET['coins'])) {
        $coins = (int)$_GET['coins'];
    }
    if (isset($_GET['reason'])) {
        $reason = $_GET['reason'];
    }
}

// Daten validieren
if ($coins <= 0) {
    sendErrorResponse('Coin-Betrag muss größer als 0 sein');
}

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Coins zum Benutzer hinzufügen
    $stmt = $db->prepare("
        UPDATE users
        SET coins = coins + :coins
        WHERE id = :id
    ");
    $stmt->execute([
        'coins' => $coins,
        'id' => $user_data['user_id']
    ]);
    
    // Neue Coin-Anzahl abrufen
    $stmt = $db->prepare("SELECT coins FROM users WHERE id = :id");
    $stmt->execute(['id' => $user_data['user_id']]);
    $user = $stmt->fetch();
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'message' => 'Coins erfolgreich hinzugefügt',
        'added_coins' => $coins,
        'new_total' => $user['coins']
    ]);
    
} catch (PDOException $e) {
    error_log("Fehler beim Hinzufügen von Coins: " . $e->getMessage());
    sendErrorResponse('Fehler beim Hinzufügen von Coins', 500);
}
?>