<?php
session_start();
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';
$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(["error" => "Not logged in"]);
    exit();
}

$user_id = $_SESSION['user_id'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $type   = $_POST['type'] ?? '';

    // ✅ LOAD
    if ($action === 'load') {
        $data = [];

        if ($type === 'allowance') {
            $stmt = $conn->prepare("SELECT allowance_id AS id, entry_date, allowance_amount AS amount, categories AS allocation FROM allowance WHERE user_id = ? ORDER BY entry_date DESC");
            $stmt->bind_param("i", $user_id);
        } elseif ($type === 'expense') {
            $stmt = $conn->prepare("SELECT expense_id AS id, entry_date, expense_amount AS amount, category FROM expenses WHERE user_id = ? ORDER BY entry_date DESC");
            $stmt->bind_param("i", $user_id);
        } elseif ($type === 'savings') {
            $stmt = $conn->prepare("
                SELECT 
                    s.saving_id AS id, s.entry_date, s.savings_amount AS amount, s.categories AS category,
                    s.goal_id, g.goal_name, g.wishlist_amount, g.wishlist_category
                FROM savings_entries s
                JOIN savings_goals g ON s.goal_id = g.goal_id
                WHERE s.user_id = ?
                ORDER BY s.entry_date DESC
            ");
            $stmt->bind_param("i", $user_id);
        } elseif ($type === 'goal') {
            $stmt = $conn->prepare("SELECT goal_id AS id, goal_name, wishlist_amount, wishlist_category FROM savings_goals WHERE user_id = ? ORDER BY goal_id DESC");
            $stmt->bind_param("i", $user_id);
        }

        if (isset($stmt)) {
            $stmt->execute();
            $result = $stmt->get_result();
            while ($row = $result->fetch_assoc()) {
                if ($type === 'allowance') {
                    $data[] = [
                        "id" => $row["id"],
                        "entry_date" => $row["entry_date"],
                        "amount" => $row["amount"],
                        "allocation" => $row["allocation"]
                    ];
                } elseif ($type === 'expense') {
                    $data[] = [
                        "id" => $row["id"],
                        "entry_date" => $row["entry_date"],
                        "amount" => $row["amount"],
                        "category" => $row["category"]
                    ];
                } elseif ($type === 'savings') {
                    $data[] = [
                        "id" => $row["id"],
                        "entry_date" => $row["entry_date"],
                        "amount" => $row["amount"],
                        "goal_id" => $row["goal_id"],
                        "goal_name" => $row["goal_name"],
                        "wishlist_amount" => $row["wishlist_amount"],
                        "wishlist_category" => $row["wishlist_category"],
                        "category" => $row["category"]
                    ];
                } elseif ($type === 'goal') {
                    $data[] = [
                        "id" => $row["id"],
                        "goal_name" => $row["goal_name"],
                        "wishlist_amount" => $row["wishlist_amount"],
                        "wishlist_category" => $row["wishlist_category"]
                    ];
                }
            }
            echo json_encode($data);
            exit();
        } else {
            http_response_code(500);
            echo json_encode(["error" => "Invalid request or database query error"]);
            exit();
        }
    }

    // ✅ INSERT (update)
    if ($action === 'update') {
        $res = [];

        if ($type === 'allowance') {
            $date = $_POST['entry_date'] ?? '';
            $amount = floatval($_POST['allowance_amount'] ?? 0);
            $allocation = $_POST['allocation'] ?? '';

            $stmt = $conn->prepare("INSERT INTO allowance (user_id, entry_date, allowance_amount, categories) VALUES (?, ?, ?, ?)");
            $stmt->bind_param("isds", $user_id, $date, $amount, $allocation);
            $stmt->execute();

            $res = [
                "id" => $stmt->insert_id,
                "entry_date" => $date,
                "amount" => $amount,
                "allocation" => $allocation
            ];

        } elseif ($type === 'expense') {
            $date = $_POST['entry_date'] ?? '';
            $amount = floatval($_POST['expense_amount'] ?? 0);
            $category = $_POST['category'] ?? '';

            $stmt = $conn->prepare("INSERT INTO expenses (user_id, entry_date, expense_amount, category) VALUES (?, ?, ?, ?)");
            $stmt->bind_param("isds", $user_id, $date, $amount, $category);
            $stmt->execute();

            $res = [
                "id" => $stmt->insert_id,
                "entry_date" => $date,
                "amount" => $amount,
                "category" => $category
            ];

        } elseif ($type === 'savings') {
            $date = $_POST['entry_date'] ?? '';
            $amount = floatval($_POST['savings_amount'] ?? 0);
            $goal_id = intval($_POST['goal_id'] ?? 0);
            $category = $_POST['categories'] ?? '';

            $stmt = $conn->prepare("INSERT INTO savings_entries (user_id, goal_id, savings_amount, entry_date, categories) VALUES (?, ?, ?, ?, ?)");
            $stmt->bind_param("iidss", $user_id, $goal_id, $amount, $date, $category);
            $stmt->execute();

            $res = [
                "id" => $stmt->insert_id,
                "entry_date" => $date,
                "amount" => $amount,
                "goal_id" => $goal_id,
                "category" => $category
            ];

        } elseif ($type === 'goal') {
            $goal = $_POST['goal_name'] ?? '';
            $target = floatval($_POST['wishlist_amount'] ?? 0);
            $category = $_POST['wishlist_category'] ?? '';

            $stmt = $conn->prepare("INSERT INTO savings_goals (user_id, goal_name, wishlist_amount, wishlist_category) VALUES (?, ?, ?, ?)");
            $stmt->bind_param("isds", $user_id, $goal, $target, $category);
            $stmt->execute();

            $res = [
                "id" => $stmt->insert_id,
                "goal_name" => $goal,
                "wishlist_amount" => $target,
                "wishlist_category" => $category
            ];
        }

        echo json_encode($res);
        exit();
    }

    // ✅ SAVE EDITS
    if ($action === 'save') {
        $id = intval($_POST['id'] ?? 0);
        $res = [];

        if ($type === 'allowance') {
            $date = $_POST['entry_date'] ?? '';
            $amount = floatval($_POST['allowance_amount'] ?? 0);
            $allocation = $_POST['allocation'] ?? '';

            $stmt = $conn->prepare("UPDATE allowance SET entry_date=?, allowance_amount=?, categories=? WHERE allowance_id=? AND user_id=?");
            $stmt->bind_param("sdsii", $date, $amount, $allocation, $id, $user_id);
            $stmt->execute();

            $res = ["id" => $id, "entry_date" => $date, "amount" => $amount, "allocation" => $allocation];

        } elseif ($type === 'expense') {
            $date = $_POST['entry_date'] ?? '';
            $amount = floatval($_POST['expense_amount'] ?? 0);
            $category = $_POST['category'] ?? '';

            $stmt = $conn->prepare("UPDATE expenses SET entry_date=?, expense_amount=?, category=? WHERE expense_id=? AND user_id=?");
            $stmt->bind_param("sdsii", $date, $amount, $category, $id, $user_id);
            $stmt->execute();

            $res = ["id" => $id, "entry_date" => $date, "amount" => $amount, "category" => $category];

        } elseif ($type === 'savings') {
            $date = $_POST['entry_date'] ?? '';
            $amount = floatval($_POST['savings_amount'] ?? 0);
            $goal_id = intval($_POST['goal_id'] ?? 0);
            $category = $_POST['categories'] ?? '';

            $stmt = $conn->prepare("UPDATE savings_entries SET entry_date=?, savings_amount=?, goal_id=?, categories=? WHERE saving_id=? AND user_id=?");
            $stmt->bind_param("sdssii", $date, $amount, $goal_id, $category, $id, $user_id);
            $stmt->execute();

            $res = ["id" => $id, "entry_date" => $date, "amount" => $amount, "goal_id" => $goal_id, "category" => $category];

        } elseif ($type === 'goal') {
            $goal = $_POST['goal_name'] ?? '';
            $target = floatval($_POST['wishlist_amount'] ?? 0);
            $category = $_POST['wishlist_category'] ?? '';

            $stmt = $conn->prepare("UPDATE savings_goals SET goal_name=?, wishlist_amount=?, wishlist_category=? WHERE goal_id=? AND user_id=?");
            $stmt->bind_param("sdsii", $goal, $target, $category, $id, $user_id);
            $stmt->execute();

            $res = ["id" => $id, "goal_name" => $goal, "wishlist_amount" => $target, "wishlist_category" => $category];
        }

        echo json_encode($res);
        exit();
    }

    // ✅ DELETE
    if ($action === 'delete') {
        $id = intval($_POST['id'] ?? 0);

        if ($type === 'allowance') {
            $stmt = $conn->prepare("DELETE FROM allowance WHERE allowance_id=? AND user_id=?");
        } elseif ($type === 'expense') {
            $stmt = $conn->prepare("DELETE FROM expenses WHERE expense_id=? AND user_id=?");
        } elseif ($type === 'savings') {
            $stmt = $conn->prepare("DELETE FROM savings_entries WHERE saving_id=? AND user_id=?");
        } elseif ($type === 'goal') {
            $stmt = $conn->prepare("DELETE FROM savings_goals WHERE goal_id=? AND user_id=?");
        }

        $stmt->bind_param("ii", $id, $user_id);
        $stmt->execute();

        echo json_encode(["status" => "deleted", "id" => $id]);
        exit();
    }

    if ($action === 'get_goal_options') {
    $stmt = $conn->prepare("SELECT goal_id, goal_name FROM savings_goals WHERE user_id = ? ORDER BY goal_id DESC");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();

    $options = [];
    while ($row = $result->fetch_assoc()) {
        $options[] = $row;
    }

    echo json_encode($options);
    exit();
}

}

echo json_encode(["error" => "Unknown action or type"]);
exit();
?>
