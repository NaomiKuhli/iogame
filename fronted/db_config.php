<?php
// db_config.php - Datenbankverbindung und Hilfsfunktionen

// Datenbankverbindungsinformationen
$db_host = 'db5017484752.hosting-data.io';
$db_name = 'dbs14021662';
$db_user = 'dbu661278';
$db_pass = 'NomNom123Nom';

// Zeitzone auf Berlin setzen
date_default_timezone_set('Europe/Berlin');

// PDO-Verbindung erstellen
function getDbConnection() {
    global $db_host, $db_name, $db_user, $db_pass;
    
    try {
        $db = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
        // Fehler als Exceptions behandeln
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        // Daten immer als assoziatives Array zurückgeben
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        return $db;
    } catch (PDOException $e) {
        // Im Produktivbetrieb keine detaillierten Fehlerinformationen ausgeben
        error_log("Datenbankfehler: " . $e->getMessage());
        return null;
    }
}

// JSON-Fehlerantwort senden
function sendErrorResponse($message, $status_code = 400) {
    http_response_code($status_code);
    echo json_encode([
        'success' => false,
        'message' => $message
    ]);
    exit;
}

// Gültigen JWT-Token generieren
function generateToken($user_id) {
    $db = getDbConnection();
    if (!$db) {
        return null;
    }
    
    // Zufälligen Token erstellen
    $token = bin2hex(random_bytes(32));
    $expires_at = date('Y-m-d H:i:s', strtotime('+30 days'));
    
    try {
        // Alte Tokens löschen (optional)
        $stmt = $db->prepare("DELETE FROM auth_tokens WHERE user_id = :user_id");
        $stmt->execute(['user_id' => $user_id]);
        
        // Neuen Token speichern
        $stmt = $db->prepare("INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (:user_id, :token, :expires_at)");
        $stmt->execute([
            'user_id' => $user_id,
            'token' => $token,
            'expires_at' => $expires_at
        ]);
        
        return $token;
    } catch (PDOException $e) {
        error_log("Token-Erstellungsfehler: " . $e->getMessage());
        return null;
    }
}

// Token validieren und Benutzer-ID zurückgeben
function validateToken($token) {
    $db = getDbConnection();
    if (!$db || !$token) {
        return null;
    }
    
    try {
        $stmt = $db->prepare("
            SELECT a.user_id, u.username
            FROM auth_tokens a
            JOIN users u ON a.user_id = u.id
            WHERE a.token = :token AND a.expires_at > NOW()
        ");
        $stmt->execute(['token' => $token]);
        
        if ($stmt->rowCount() > 0) {
            return $stmt->fetch();
        } else {
            return null;
        }
    } catch (PDOException $e) {
        error_log("Token-Validierungsfehler: " . $e->getMessage());
        return null;
    }
}

// Benutzer-ID aus Authorization-Header extrahieren
function getUserFromAuthHeader() {
    // Authorization-Header extrahieren
    $auth_header = '';
    
    // Methode 1: getallheaders() wenn verfügbar
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (isset($headers['Authorization'])) {
            $auth_header = $headers['Authorization'];
        } elseif (isset($headers['authorization'])) {
            // Manchmal werden Header kleingeschrieben
            $auth_header = $headers['authorization'];
        }
    }
    
    // Methode 2: Apache-spezifische Methode
    if (empty($auth_header) && isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth_header = $_SERVER['HTTP_AUTHORIZATION'];
    }
    
    // Methode 3: Für einige FastCGI Setups
    if (empty($auth_header) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $auth_header = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    
    // Methode 4: Manuelles Extrahieren aus Apache-Request-Headers
    if (empty($auth_header) && function_exists('apache_request_headers')) {
        $request_headers = apache_request_headers();
        if (isset($request_headers['Authorization'])) {
            $auth_header = $request_headers['Authorization'];
        } elseif (isset($request_headers['authorization'])) {
            $auth_header = $request_headers['authorization'];
        }
    }
    
    // Debugging - in error_log schreiben
    error_log("Auth Header: " . $auth_header);
    
    // Token extrahieren und validieren
    if (!empty($auth_header) && preg_match('/Bearer\s+(.*)$/i', $auth_header, $matches)) {
        $token = $matches[1];
        return validateToken($token);
    }
    
    return null;
}

// Generiere tägliche Missionen
function generateDailyMissions() {
    $db = getDbConnection();
    if (!$db) {
        return false;
    }
    
    // Deutsche Zeitzone einstellen
    date_default_timezone_set('Europe/Berlin');
    
    // Missiontypen
    $mission_types = [
        ['type' => 'kill_enemies', 'description' => 'Töte %d Gegner', 'min' => 3, 'max' => 10, 'reward_min' => 50, 'reward_max' => 150],
        ['type' => 'play_minutes', 'description' => 'Spiele %d Minuten', 'min' => 5, 'max' => 15, 'reward_min' => 50, 'reward_max' => 150],
        ['type' => 'survive_minutes', 'description' => 'Überlebe %d Minuten', 'min' => 3, 'max' => 10, 'reward_min' => 50, 'reward_max' => 200],
        ['type' => 'reach_level', 'description' => 'Erreiche Level %d', 'min' => 5, 'max' => 15, 'reward_min' => 100, 'reward_max' => 300],
        ['type' => 'destroy_blocks', 'description' => 'Zerstöre %d Blöcke', 'min' => 10, 'max' => 30, 'reward_min' => 50, 'reward_max' => 150],
        ['type' => 'collect_xp', 'description' => 'Sammle %d XP', 'min' => 100, 'max' => 500, 'reward_min' => 50, 'reward_max' => 200]
    ];
    
    try {
        // Bestehende Missionen löschen, die abgelaufen sind
        $db->exec("DELETE FROM daily_missions WHERE expires_at <= NOW()");
        
        // Aktuelles Datum in Berlin-Zeitzone
        $today = date('Y-m-d');
        
        // Prüfen, ob es bereits Missionen für heute gibt
        $stmt = $db->prepare("
            SELECT COUNT(*) as count 
            FROM daily_missions 
            WHERE DATE(created_at) = :today
        ");
        $stmt->execute(['today' => $today]);
        $result = $stmt->fetch();
        
        // Nur neue Missionen erstellen, wenn heute keine erstellt wurden
        if ($result['count'] === 0) {
            // Ablaufdatum: Morgen 00:00 Uhr (Berlin-Zeit)
            $expires_at = date('Y-m-d H:i:s', strtotime('tomorrow midnight'));
            
            // Zufällig 3 Mission-Typen auswählen (ohne Wiederholung)
            shuffle($mission_types);
            $selected_missions = array_slice($mission_types, 0, 3);
            
            foreach ($selected_missions as $mission) {
                // Zufälligen Zielwert und Belohnung festlegen
                $target = rand($mission['min'], $mission['max']);
                $reward = rand($mission['reward_min'], $mission['reward_max']);
                
                // Beschreibung formatieren
                $description = sprintf($mission['description'], $target);
                
                // Mission in Datenbank speichern
                $stmt = $db->prepare("
                    INSERT INTO daily_missions (description, type, target, reward, expires_at, created_at)
                    VALUES (:description, :type, :target, :reward, :expires_at, NOW())
                ");
                
                $stmt->execute([
                    'description' => $description,
                    'type' => $mission['type'],
                    'target' => $target,
                    'reward' => $reward,
                    'expires_at' => $expires_at
                ]);
            }
            
            error_log("Neue tägliche Missionen für " . $today . " erstellt");
        }
        
        return true;
    } catch (PDOException $e) {
        error_log("Fehler bei der Missionsgenerierung: " . $e->getMessage());
        return false;
    }
}

// Missionsfortschritt aktualisieren
function updateMissionProgress($user_id, $mission_type, $amount) {
    $db = getDbConnection();
    if (!$db) {
        return false;
    }
    
    // Deutsche Zeitzone einstellen
    date_default_timezone_set('Europe/Berlin');
    
    try {
        // Aktive Missionen vom angegebenen Typ abrufen
        $stmt = $db->prepare("
            SELECT dm.id, dm.target
            FROM daily_missions dm
            WHERE dm.type = :type AND dm.expires_at > NOW()
        ");
        $stmt->execute(['type' => $mission_type]);
        $missions = $stmt->fetchAll();
        
        if (empty($missions)) {
            return false; // Keine passenden Missionen gefunden
        }
        
        $updated = false;
        
        foreach ($missions as $mission) {
            // Prüfen, ob bereits ein Fortschritt existiert
            $stmt = $db->prepare("
                SELECT id, progress, claimed
                FROM user_missions
                WHERE user_id = :user_id AND mission_id = :mission_id
            ");
            $stmt->execute([
                'user_id' => $user_id,
                'mission_id' => $mission['id']
            ]);
            $user_mission = $stmt->fetch();
            
            if ($user_mission) {
                // Nur aktualisieren, wenn noch nicht abgeschlossen oder beansprucht
                if ($user_mission['claimed'] == 0 && $user_mission['progress'] < $mission['target']) {
                    // Fortschritt aktualisieren
                    $new_progress = min($mission['target'], $user_mission['progress'] + $amount);
                    
                    $stmt = $db->prepare("
                        UPDATE user_missions
                        SET progress = :progress
                        WHERE id = :id
                    ");
                    $stmt->execute([
                        'progress' => $new_progress,
                        'id' => $user_mission['id']
                    ]);
                    
                    $updated = true;
                }
            } else {
                // Neuen Fortschritt anlegen
                $progress = min($mission['target'], $amount);
                
                $stmt = $db->prepare("
                    INSERT INTO user_missions (user_id, mission_id, progress)
                    VALUES (:user_id, :mission_id, :progress)
                ");
                $stmt->execute([
                    'user_id' => $user_id,
                    'mission_id' => $mission['id'],
                    'progress' => $progress
                ]);
                
                $updated = true;
            }
        }
        
        return $updated;
    } catch (PDOException $e) {
        error_log("Fehler bei der Aktualisierung des Missionsfortschritts: " . $e->getMessage());
        return false;
    }
}

// REST-Anforderungstyp prüfen
function checkRequestMethod($method) {
    if ($_SERVER['REQUEST_METHOD'] !== $method) {
        sendErrorResponse("Nur $method-Anfragen sind erlaubt", 405);
    }
}
?>