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

// Zeitzone auf Berlin setzen
date_default_timezone_set('Europe/Berlin');

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

// Daten aus dem Request-Body oder Query-Parametern lesen
$mission_type = '';
$amount = 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['type'])) {
        $mission_type = $data['type'];
    }
    if (isset($data['amount'])) {
        $amount = (int)$data['amount'];
    }
} else {
    if (isset($_GET['type'])) {
        $mission_type = $_GET['type'];
    }
    if (isset($_GET['amount'])) {
        $amount = (int)$_GET['amount'];
    }
}

// Daten validieren
if (!$mission_type || $amount <= 0) {
    sendErrorResponse('Missionstyp und Betrag sind erforderlich');
}

// Abgeschlossene Missionen speichern
$completed_missions = [];

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Aktive Missionen vom angegebenen Typ abrufen
    $stmt = $db->prepare("
        SELECT dm.id, dm.type, dm.target, dm.reward, dm.description, um.progress, um.claimed
        FROM daily_missions dm
        LEFT JOIN user_missions um ON dm.id = um.mission_id AND um.user_id = :user_id
        WHERE dm.type = :type AND dm.expires_at > NOW()
    ");
    $stmt->execute([
        'user_id' => $user_data['user_id'],
        'type' => $mission_type
    ]);
    $missions = $stmt->fetchAll();
    
    if (empty($missions)) {
        // Keine passenden Missionen gefunden
        header('Content-Type: application/json');
        echo json_encode([
            'success' => true,
            'message' => 'Keine passenden Missionen gefunden',
            'completed_missions' => []
        ]);
        exit;
    }
    
    foreach ($missions as $mission) {
        // Aktueller Fortschritt (falls vorhanden)
        $current_progress = $mission['progress'] ?: 0;
        
        // Neuer Fortschritt
        $new_progress = min($mission['target'], $current_progress + $amount);
        
        // Prüfen, ob bereits ein Eintrag existiert
        $stmt = $db->prepare("
            SELECT id FROM user_missions
            WHERE user_id = :user_id AND mission_id = :mission_id
        ");
        $stmt->execute([
            'user_id' => $user_data['user_id'],
            'mission_id' => $mission['id']
        ]);
        
        if ($stmt->rowCount() === 0) {
            // Eintrag erstellen
            $stmt = $db->prepare("
                INSERT INTO user_missions (user_id, mission_id, progress)
                VALUES (:user_id, :mission_id, :progress)
            ");
        } else {
            // Eintrag aktualisieren
            $stmt = $db->prepare("
                UPDATE user_missions
                SET progress = :progress
                WHERE user_id = :user_id AND mission_id = :mission_id
            ");
        }
        
        $stmt->execute([
            'user_id' => $user_data['user_id'],
            'mission_id' => $mission['id'],
            'progress' => $new_progress
        ]);
        
        // Prüfen, ob Mission gerade abgeschlossen wurde (vorher nicht erreicht, jetzt ja)
        if ($current_progress < $mission['target'] && $new_progress >= $mission['target'] && !$mission['claimed']) {
            $completed_missions[] = [
                'id' => $mission['id'],
                'description' => $mission['description'],
                'reward' => $mission['reward']
            ];
        }
    }
    
    // Erfolgsantwort mit abgeschlossenen Missionen
    header('Content-Type: application/json');
    echo json_encode([
        'success' => true,
        'message' => 'Fortschritt aktualisiert',
        'completed_missions' => $completed_missions
    ]);
    
} catch (PDOException $e) {
    error_log("Fehler bei der Aktualisierung des Missionsfortschritts: " . $e->getMessage());
    sendErrorResponse('Fehler bei der Aktualisierung', 500);
}
?>