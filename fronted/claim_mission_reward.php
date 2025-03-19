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

// Get mission ID from request body
$data = json_decode(file_get_contents('php://input'), true);

// Validate mission ID
if (!isset($data['mission_id'])) {
    sendErrorResponse('Missions-ID ist erforderlich');
}

$mission_id = (int)$data['mission_id'];

// Establish database connection
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Start transaction
    $db->beginTransaction();
    
    // Get mission and progress
    $stmt = $db->prepare("
        SELECT dm.*, um.progress, um.claimed
        FROM daily_missions dm
        LEFT JOIN user_missions um ON dm.id = um.mission_id AND um.user_id = :user_id
        WHERE dm.id = :mission_id AND dm.expires_at > NOW()
    ");
    $stmt->execute([
        'user_id' => $user_data['user_id'],
        'mission_id' => $mission_id
    ]);
    
    if ($stmt->rowCount() === 0) {
        $db->rollBack();
        sendErrorResponse('Mission nicht gefunden oder abgelaufen');
    }
    
    $mission = $stmt->fetch();
    
    // Check if mission is completed but not claimed yet
    if (!$mission['progress'] || $mission['progress'] < $mission['target']) {
        $db->rollBack();
        sendErrorResponse('Mission noch nicht abgeschlossen');
    }
    
    if ($mission['claimed']) {
        $db->rollBack();
        sendErrorResponse('Belohnung bereits eingefordert');
    }
    
    // Mark reward as claimed
    $stmt = $db->prepare("
        UPDATE user_missions
        SET claimed = 1
        WHERE user_id = :user_id AND mission_id = :mission_id
    ");
    $stmt->execute([
        'user_id' => $user_data['user_id'],
        'mission_id' => $mission_id
    ]);
    
    // Add coins to user
    $stmt = $db->prepare("
        UPDATE users
        SET coins = coins + :reward
        WHERE id = :id
    ");
    $stmt->execute([
        'reward' => $mission['reward'],
        'id' => $user_data['user_id']
    ]);
    
    // Get new coin count
    $stmt = $db->prepare("SELECT coins FROM users WHERE id = :id");
    $stmt->execute(['id' => $user_data['user_id']]);
    $user = $stmt->fetch();
    
    // Complete transaction
    $db->commit();
    
    // Send success response
    header('Content-Type: application/json');
    echo json_encode([
        'success' => true,
        'message' => 'Belohnung erfolgreich eingefordert',
        'reward' => $mission['reward'],
        'new_coins' => $user['coins']
    ]);
    
} catch (PDOException $e) {
    $db->rollBack();
    error_log("Fehler beim Einfordern der Missionsbelohnung: " . $e->getMessage());
    sendErrorResponse('Fehler beim Einfordern der Belohnung', 500);
}
?>