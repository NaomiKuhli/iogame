<?php
// Add CORS headers
header("Access-Control-Allow-Origin: *");  // Or specify your game domain instead of *
header("Access-Control-Allow-Methods: GET, OPTIONS");
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

// Nur GET-Anfragen erlauben (after OPTIONS check)
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendErrorResponse('Nur GET-Anfragen sind erlaubt', 405);
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

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Alle verfügbaren Upgrades abrufen
    $stmt = $db->prepare("SELECT * FROM upgrades ORDER BY cost ASC");
    $stmt->execute();
    $upgrades = $stmt->fetchAll();
    
    // Erfolgsantwort senden
    header('Content-Type: application/json');
    echo json_encode([
        'success' => true,
        'items' => $upgrades
    ]);
    
} catch (PDOException $e) {
    error_log("Fehler beim Abrufen der Shop-Items: " . $e->getMessage());
    sendErrorResponse('Fehler beim Abrufen der Shop-Items', 500);
}
?>