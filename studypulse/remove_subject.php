<?php
session_start();
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['status' => 'unauthorized']);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['user_subject_id'])) {
    $host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

    if ($conn->connect_error) {
        echo json_encode(['status' => 'db_error', 'message' => $conn->connect_error]);
        exit();
    }

    $user_subject_id = intval($_POST['user_subject_id']);
    $user_id = $_SESSION['user_id'];

    // Check ownership and get subject_id
    $stmt = $conn->prepare("SELECT subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $user_subject_id, $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    if ($result->num_rows === 0) {
        echo json_encode(['status' => 'not_found']);
        exit();
    }
    $subject_id = $result->fetch_assoc()['subject_id'];
    $stmt->close();

    // Delete related entries (tasks, quizzes, etc.)
    $tables = ['grade_settings', 'tasks', 'activities', 'quizzes', 'exams'];
    foreach ($tables as $table) {
        $conn->query("DELETE FROM $table WHERE user_subject_id = $user_subject_id");
    }

    // Delete from user_subjects
    $stmt = $conn->prepare("DELETE FROM user_subjects WHERE user_subject_id = ?");
    $stmt->bind_param("i", $user_subject_id);
    $stmt->execute();
    $stmt->close();

    // If no one else is using the subject, delete it
    $check = $conn->prepare("SELECT COUNT(*) AS total FROM user_subjects WHERE subject_id = ?");
    $check->bind_param("i", $subject_id);
    $check->execute();
    $total = $check->get_result()->fetch_assoc()['total'];
    $check->close();

    if ($total == 0) {
        $stmt = $conn->prepare("DELETE FROM subjects WHERE subject_id = ?");
        $stmt->bind_param("i", $subject_id);
        $stmt->execute();
        $stmt->close();
    }

    echo json_encode(['status' => 'success']);
    $conn->close();
} else {
    echo json_encode(['status' => 'invalid']);
}
