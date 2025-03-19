<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Prüfen, ob es eine OPTIONS-Anfrage ist (CORS preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Fehlerprotokollierung aktivieren
ini_set('display_errors', 0);
ini_set('log_errors', 1);
error_log("Register.php wurde aufgerufen");

try {
    // JSON-Daten aus dem Request-Body lesen
    $data = json_decode(file_get_contents('php://input'), true);
    
    if (!$data) {
        error_log("Keine Daten empfangen oder ungültiges JSON");
        echo json_encode(['success' => false, 'message' => 'Keine Daten empfangen oder ungültiges JSON']);
        exit;
    }
    
    error_log("Daten empfangen: " . print_r($data, true));
    
    // Einfach erfolgreich antworten für Testzwecke
    echo json_encode([
        'success' => true,
        'message' => 'Registrierung erfolgreich! (Testversion)',
        'data_received' => $data
    ]);
    
} catch (Exception $e) {
    error_log("Fehler bei der Registrierung: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Ein Fehler ist aufgetreten: ' . $e->getMessage()]);
}
?>