<?php
session_start();
if (!isset($_SESSION['user_id'])) {
    http_response_code(403);
    echo "Unauthorized";
    exit();
}

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

$entry_id = intval($_POST['entry_id'] ?? 0);
$type = $_POST['type'] ?? '';

if (!$entry_id || !$type) {
    http_response_code(400);
    echo "Missing ID or type.";
    exit();
}

$conn = new mysqli("localhost", "root", "", "vibeboard");
if ($conn->connect_error) {
    http_response_code(500);
    echo "Database error.";
    exit();
}

$tableMap = [
    'activities' => ['table' => 'activities', 'id' => 'activity_id'],
    'quizzes' => ['table' => 'quizzes', 'id' => 'quiz_id'],
    'exams' => ['table' => 'exams', 'id' => 'exam_id']
];

if (!isset($tableMap[$type])) {
    http_response_code(400);
    echo "Invalid type.";
    exit();
}

$table = $tableMap[$type]['table'];
$idField = $tableMap[$type]['id'];

$stmt = $conn->prepare("DELETE FROM $table WHERE $idField = ?");
$stmt->bind_param("i", $entry_id);

if ($stmt->execute()) {
    echo "Deleted successfully.";
} else {
    http_response_code(500);
    echo "Failed to delete: " . $stmt->error;
}

$stmt->close();
$conn->close();
?>
