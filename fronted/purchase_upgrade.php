<?php
// Add CORS headers
header("Access-Control-Allow-Origin: *");  // Or specify your game domain instead of *
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Suppress error display but log them
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Require database configuration
require_once 'db_config.php';

// Nur POST-Anfragen erlauben (after OPTIONS check)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendErrorResponse('Nur POST-Anfragen sind erlaubt', 405);
}

// Get token (simplified token collection from multiple sources)
$token = '';

// 1. From URL parameter
if (isset($_GET['token'])) {
    $token = $_GET['token'];
}
// 2. From request body (for POST requests)
else {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['token'])) {
        $token = $data['token'];
    }
    // 3. From Authorization header (fallback)
    else if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        if (preg_match('/Bearer\s+(.*)$/i', $_SERVER['HTTP_AUTHORIZATION'], $matches)) {
            $token = $matches[1];
        }
    }
    else if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (isset($headers['Authorization'])) {
            if (preg_match('/Bearer\s+(.*)$/i', $headers['Authorization'], $matches)) {
                $token = $matches[1];
            }
        }
    }
}

// Validate token
if (empty($token)) {
    sendErrorResponse('Token ist erforderlich', 401);
}

$user_data = validateToken($token);
if (!$user_data) {
    sendErrorResponse('Ungültiger oder abgelaufener Token', 401);
}

// JSON-Daten aus dem Request-Body lesen
$data = json_decode(file_get_contents('php://input'), true);

// Daten validieren
if (!isset($data['upgrade_id'])) {
    sendErrorResponse('Upgrade-ID ist erforderlich');
}

$upgrade_id = (int)$data['upgrade_id'];

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Transaktion starten
    $db->beginTransaction();
    
    // Upgrade-Informationen abrufen
    $stmt = $db->prepare("SELECT * FROM upgrades WHERE id = :id");
    $stmt->execute(['id' => $upgrade_id]);
    
    if ($stmt->rowCount() === 0) {
        $db->rollBack();
        sendErrorResponse('Upgrade nicht gefunden');
    }
    
    $upgrade = $stmt->fetch();
    
    // Prüfen, ob Benutzer das Upgrade bereits besitzt
    $stmt = $db->prepare("
        SELECT * FROM user_upgrades 
        WHERE user_id = :user_id AND upgrade_id = :upgrade_id
    ");
    $stmt->execute([
        'user_id' => $user_data['user_id'],
        'upgrade_id' => $upgrade_id
    ]);
    
    if ($stmt->rowCount() > 0) {
        $db->rollBack();
        sendErrorResponse('Du besitzt dieses Upgrade bereits');
    }
    
    // Prüfen, ob Benutzer genug Coins hat
    $stmt = $db->prepare("SELECT coins FROM users WHERE id = :id");
    $stmt->execute(['id' => $user_data['user_id']]);
    $user = $stmt->fetch();
    
    if ($user['coins'] < $upgrade['cost']) {
        $db->rollBack();
        sendErrorResponse('Nicht genug Coins für dieses Upgrade');
    }
    
    // Coins abziehen
    $new_coins = $user['coins'] - $upgrade['cost'];
    $stmt = $db->prepare("UPDATE users SET coins = :coins WHERE id = :id");
    $stmt->execute([
        'coins' => $new_coins,
        'id' => $user_data['user_id']
    ]);
    
    // Upgrade zum Benutzer hinzufügen
    $stmt = $db->prepare("
        INSERT INTO user_upgrades (user_id, upgrade_id) 
        VALUES (:user_id, :upgrade_id)
    ");
    $stmt->execute([
        'user_id' => $user_data['user_id'],
        'upgrade_id' => $upgrade_id
    ]);
    
    // Alle gekauften Upgrades abrufen
    $stmt = $db->prepare("
        SELECT u.* 
        FROM upgrades u
        JOIN user_upgrades uu ON u.id = uu.upgrade_id
        WHERE uu.user_id = :user_id
    ");
    $stmt->execute(['user_id' => $user_data['user_id']]);
    $user_upgrades = $stmt->fetchAll();
    
    // Transaktion abschließen
    $db->commit();
    
    // Erfolgsantwort senden
    header('Content-Type: application/json');
    echo json_encode([
        'success' => true,
        'message' => 'Upgrade erfolgreich gekauft',
        'new_coins' => $new_coins,
        'upgrades' => $user_upgrades
    ]);
    
} catch (PDOException $e) {
    $db->rollBack();
    error_log("Fehler beim Kauf eines Upgrades: " . $e->getMessage());
    sendErrorResponse('Fehler beim Kauf des Upgrades', 500);
}
?>