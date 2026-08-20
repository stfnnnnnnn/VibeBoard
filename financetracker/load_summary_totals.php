<?php
session_start();
header('Content-Type: application/json');

// Database connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// Authentication check
if (!isset($_SESSION['user_id'])) {
    die(json_encode(["error" => "Unauthorized"]));
}
$user_id = $_SESSION['user_id'];

// Get filter and date
$filter = $_POST['filter'] ?? 'month';
$today = $_POST['date'] ?? date('Y-m-d');

// 🗓 Determine range
if ($filter === 'month') {
    // CURRENT WEEK (Monday to Sunday)
    $ts = strtotime($today);
    $start = date('Y-m-d', strtotime('monday this week', $ts));
    $end   = date('Y-m-d', strtotime('sunday this week', $ts));
} elseif ($filter === 'year') {
    // CURRENT MONTH
    $start = date('Y-m-01', strtotime($today));
    $end   = date('Y-m-t', strtotime($today));
} elseif ($filter === 'all') {
    $start = '2000-01-01';
    $end   = date('Y-m-d');
} else {
    echo json_encode(["error" => "Invalid filter"]);
    exit;
}

// Function to get total from a table
function getTotal($conn, $table, $column, $user_id, $start, $end) {
    $stmt = $conn->prepare("SELECT SUM($column) AS total FROM $table WHERE user_id = ? AND entry_date BETWEEN ? AND ?");
    $stmt->bind_param("iss", $user_id, $start, $end);
    $stmt->execute();
    $res = $stmt->get_result();
    $row = $res->fetch_assoc();
    return floatval($row['total'] ?? 0);
}

// Totals
$total_allowance = getTotal($conn, "allowance", "allowance_amount", $user_id, $start, $end);
$total_expense   = getTotal($conn, "expenses", "expense_amount", $user_id, $start, $end);
$total_savings   = getTotal($conn, "savings_entries", "savings_amount", $user_id, $start, $end);

$response = [
    "filter" => $filter,
    "date_range" => [$start, $end],
    "summary" => [
        "total_allowance" => $total_allowance,
        "total_expense" => $total_expense,
        "total_savings" => $total_savings,
        "remaining" => $total_allowance - ($total_expense + $total_savings)
    ]
];

// Optionally: Log response
// file_put_contents("debug_totals.json", json_encode($response, JSON_PRETTY_PRINT));

echo json_encode($response);
?>
