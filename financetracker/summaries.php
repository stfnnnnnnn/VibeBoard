<?php
session_start();
header('Content-Type: application/json');

// DB Connection
$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

if (!isset($_SESSION['user_id'])) die(json_encode(["error" => "Unauthorized"]));
$user_id = $_SESSION['user_id'];

// Get filter
$filter = $_POST['filter'] ?? 'month'; // default to month
$date = $_POST['date'] ?? date('Y-m-d');

if ($filter == 'month') {
    $start = date('Y-m-01', strtotime($date));
    $end = date('Y-m-t', strtotime($date));
} elseif ($filter == 'year') {
    $start = date('Y-01-01', strtotime($date));
    $end = date('Y-12-31', strtotime($date));
} elseif ($filter == 'all') {
    $start = '2000-01-01'; // or earliest possible date
    $end = date('Y-m-d');
} else {
    echo json_encode(["error" => "Invalid filter"]);
    exit();
}

$response = [
    'filter' => $filter,
    'summary' => [],
    'breakdown' => [],
    'goals' => []
];

// 🧮 Helper: Get week/month index
function getIndex($entry_date, $filter) {
    if ($filter === 'month') {
        $date = strtotime($entry_date);
        $first_day = strtotime(date('Y-m-01', $date));
        $day_of_week_first = date('N', $first_day); // 1 = Monday, 7 = Sunday
        $days_since_first_monday = (date('j', $date) + $day_of_week_first - 2);
        return max(0, min(3, floor($days_since_first_monday / 7)));
    } else {
        return intval(date('n', strtotime($entry_date))) - 1; // 0 to 11
    }
}

// 🎯 1. Goals with Progress
$goals_sql = "
    SELECT g.goal_id, g.goal_name, g.wishlist_amount,
           COALESCE(SUM(s.savings_amount), 0) AS total_saved
    FROM savings_goals g
    LEFT JOIN savings_entries s 
        ON g.goal_id = s.goal_id AND s.entry_date BETWEEN ? AND ?
    WHERE g.user_id = ?
    GROUP BY g.goal_id
";
$stmt = $conn->prepare($goals_sql);
$stmt->bind_param("ssi", $start, $end, $user_id);
$stmt->execute();
$goals_result = $stmt->get_result();
while ($row = $goals_result->fetch_assoc()) {
    $progress = ($row['wishlist_amount'] > 0)
        ? round(($row['total_saved'] / $row['wishlist_amount']) * 100, 2)
        : 0;
    $response['goals'][] = [
        'goal_id' => $row['goal_id'],
        'goal_name' => $row['goal_name'],
        'target_amount' => $row['wishlist_amount'],
        'saved' => $row['total_saved'],
        'progress_percent' => $progress
    ];
}

// 🏦 2. Allowance Breakdown
$allowance_data = array_fill(0, ($filter == 'month' ? 4 : 12), 0);
$total_allowance = 0;
$allowance_sql = "
    SELECT entry_date, allowance_amount
    FROM allowance
    WHERE user_id = ? AND entry_date BETWEEN ? AND ?
";
$stmt = $conn->prepare($allowance_sql);
$stmt->bind_param("iss", $user_id, $start, $end);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $idx = getIndex($row['entry_date'], $filter);
    $allowance_data[$idx] += floatval($row['allowance_amount']);
    $total_allowance += floatval($row['allowance_amount']);
}
$response['breakdown']['allowance'] = $allowance_data;

// 💸 3. Expense Breakdown by Category
$expense_data = array_fill(0, ($filter == 'month' ? 4 : 12), []);
$total_expense = 0;
$expense_sql = "
    SELECT entry_date, category, expense_amount
    FROM expenses
    WHERE user_id = ? AND entry_date BETWEEN ? AND ?
";
$stmt = $conn->prepare($expense_sql);
$stmt->bind_param("iss", $user_id, $start, $end);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $idx = getIndex($row['entry_date'], $filter);
    $cat = $row['category'];
    $amt = floatval($row['expense_amount']);
    if (!isset($expense_data[$idx][$cat])) $expense_data[$idx][$cat] = 0;
    $expense_data[$idx][$cat] += $amt;
    $total_expense += $amt;
}
$response['breakdown']['expenses'] = $expense_data;

// ➕ Add flat total array for bar chart
$response['breakdown']['expenses_total'] = array_map(function ($week) {
    return array_sum($week);
}, $expense_data);

// 💰 4. Savings Breakdown by Category
$saving_data = array_fill(0, ($filter == 'month' ? 4 : 12), []);
$total_savings = 0;
$saving_sql = "
    SELECT s.entry_date, g.goal_name, s.savings_amount
    FROM savings_entries s
    LEFT JOIN savings_goals g ON s.goal_id = g.goal_id
    WHERE s.user_id = ? AND s.entry_date BETWEEN ? AND ?
";
$stmt = $conn->prepare($saving_sql);
$stmt->bind_param("iss", $user_id, $start, $end);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $idx = getIndex($row['entry_date'], $filter);
    $cat = $row['goal_name'] ?? 'Uncategorized';
    $amt = floatval($row['savings_amount']);
    if (!isset($saving_data[$idx][$cat])) $saving_data[$idx][$cat] = 0;
    $saving_data[$idx][$cat] += $amt;
    $total_savings += $amt;
}
$response['breakdown']['savings'] = $saving_data;

// ➕ Add flat total array for bar chart
$response['breakdown']['savings_total'] = array_map(function ($week) {
    return array_sum($week);
}, $saving_data);

// 📊 5. Monthly/Yearly Summary
$response['summary'] = [
    'total_allowance' => $total_allowance,
    'total_expense' => $total_expense,
    'total_savings' => $total_savings,
    'remaining' => $total_allowance - ($total_expense + $total_savings)
];

// ✅ Debug output (optional)
file_put_contents("debug_summary.json", json_encode($response, JSON_PRETTY_PRINT));

echo json_encode($response);
?>
