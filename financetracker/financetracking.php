<?php
session_start();
if (!isset($_SESSION['user_id'], $_SESSION['first_name'])) {
    header('Location: ../login.php');
    exit();
}

$user_id = $_SESSION['user_id'];
$first_name = htmlspecialchars($_SESSION['first_name']);

$host = 'mysql-vibeboard.alwaysdata.net';
$user = 'vibeboard';
$pass = '***REDACTED***';
$db   = 'vibeboard_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// ✅ Get goal options safely and early
$goalOptions = [];
$stmt = $conn->prepare("SELECT goal_id, goal_name FROM savings_goals WHERE user_id = ?");
$stmt->bind_param("i", $user_id);
$stmt->execute();
$result = $stmt->get_result();
while ($row = $result->fetch_assoc()) {
    $goalOptions[] = $row;
}
$stmt->close(); // close after use

// 🕒 Set date range for past 7 days
$seven_days_ago = date('Y-m-d', strtotime('-6 days'));

// ✅ Get total weekly expenses
$week_expense_total = 0;
$exp_stmt = $conn->prepare("SELECT SUM(expense_amount) AS total FROM expenses WHERE user_id = ? AND entry_date >= ?");
$exp_stmt->bind_param("is", $user_id, $seven_days_ago);
$exp_stmt->execute();
$exp_result = $exp_stmt->get_result()->fetch_assoc();
$week_expense_total = $exp_result['total'] ?? 0.00;
$exp_stmt->close();

// ✅ Get total weekly savings
$week_savings_total = 0;
$sav_stmt = $conn->prepare("SELECT SUM(savings_amount) AS total FROM savings_entries WHERE user_id = ? AND entry_date >= ?");
$sav_stmt->bind_param("is", $user_id, $seven_days_ago);
$sav_stmt->execute();
$sav_result = $sav_stmt->get_result()->fetch_assoc();
$week_savings_total = $sav_result['total'] ?? 0.00;
$sav_stmt->close();

// ✅ Get total allowance
$totalAllowance = 0;
$all_stmt = $conn->prepare("SELECT SUM(allowance_amount) FROM allowance WHERE user_id = ?");
$all_stmt->bind_param("i", $user_id);
$all_stmt->execute();
$all_stmt->bind_result($totalAllowance);
$all_stmt->fetch();
$all_stmt->close();

// ✅ Get total expenses
$totalExpense = 0;
$exp2_stmt = $conn->prepare("SELECT SUM(expense_amount) FROM expenses WHERE user_id = ?");
$exp2_stmt->bind_param("i", $user_id);
$exp2_stmt->execute();
$exp2_stmt->bind_result($totalExpense);
$exp2_stmt->fetch();
$exp2_stmt->close();

// ✅ Calculate available balance
$availableBalance = max(0, $totalAllowance - $totalExpense);
?>


<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Finance Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet" />
   <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>

  <style>
  * {
    margin: 0; padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', 'Poppins', sans-serif;
  }

          @keyframes gradientFlow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

  body {
  background: linear-gradient(-45deg, #a6d8ff, #ffcde1, #c2e9fb, #f9c5d1);
  background-size: 300% 300%;
  animation: gradientFlow 12s ease infinite;
    min-height: 100vh;
    padding: 30px 20px 160px;
    color: #333;
  }

  h1 {
    text-align: left;
    margin-left: 40px;
    font-size: 2rem;
    font-weight: 800;
    margin-bottom: 20px;
    background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

    .h2-text {
    background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .h2 text-header{
        text-align: center;
    font-size: 2rem;
    font-weight: 800;
    margin-bottom: 20px;
    background: linear-gradient(to right, #4dabf5, #ec407a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent
  }

    .logo-text{
    text-align: center;
    display: flex;
    flex: nowrap;
    font-size:1.2rem;
    font-weight: 800;
    margin-bottom: 10px;
    }

  .dashboard {
    max-width: 1400px;
    margin: auto;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .top-row {
    display: grid;
    grid-template-columns: 0.9fr 0.9fr;
    gap: 24px;
  }

  .bottom-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    align-items: flex-start;
    align-items: stretch;
  }

  .left-panel {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .card-box {
    background: rgba(255, 255, 255, 0.55);
    backdrop-filter: blur(15px);
    border-radius: 25px;
    padding: 25px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.08);
    border: 1px solid rgba(255,255,255,0.25);
  }

  .entry-type-buttons, .filter-buttons {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }

  .entry-type-buttons button, .filter-buttons button {
    padding: 5px 20px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(to right, #81d4fa, #f48fb1);
    color: #ffffffff;
    font-weight: 700;
    cursor: pointer;
  }

  .entry-type-buttons button.active,
  .filter-buttons button.active {
    background: linear-gradient(to right, #4dabf5, #ec407a);
    color: #fff;
  }

  .action-cell {
  text-align: center;
  white-space: nowrap;
}

.edit-btn,.save-btn, .delete-btn {
  margin: 0 2px;
  padding: 4px 6px;
  border-radius: 20px;
  font-size: 14px;
  border: none;
  cursor: pointer;
  background: transparent;
}

.edit-btn{
    background-color: #fbdf12ff;
}

.delete-btn{
    background-color: #ff1515ff;
}

.save-btn{
    background-color: #19edcaff;
}
.cell-edit input,
.cell-edit select {
  width: 100%;
  padding: 10px 14px;       /* same as td */
  font-weight: 1000;        /* match td font weight */
  color: #4dabf5;           /* match td color */
  background: rgba(255,255,255,0.6);
  border: none;
  border-radius: 10px;
  backdrop-filter: blur(10px);
  font-family: inherit;
  font-size: inherit;
  outline: none;
  box-sizing: border-box;
}
.cell-edit input:focus,
.cell-edit select:focus {
  outline: 2px solid #a484c4;
}

.home-btn {
  margin-left: auto;
  margin-right: 40px;
  background: transparent; /* Make button blend with background */
  border: none;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 1rem;
  cursor: pointer;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.08));
  transition: background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  transform: translateY(18px); /* or remove this */
  height: 40px;
  width: 40px;
  transform: translateY(-10px);
}

.home-btn i {
  background: linear-gradient(90deg, #f0679d, #74bcd9, #f0679d);
  background-size: 200% auto;
  background-position: left center;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 1.5rem;
}

      .title-with-home {
  display: flex;
  align-items: center;
  gap: 10px;
}

  .form-section {
    display: none;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 10px;
  }

  .form-section.active {
    display: flex;
  }

  .form-row {
    display: flex;
    flex-wrap: wrap;
    margin-top: 10px;
    gap: 14px;
  }

  input, select {
    padding: 12px 18px;
    border: none;
    border-radius: 12px;
    background: rgba(255,255,255,0.8);
    box-shadow: inset 0 1px 4px rgba(0,0,0,0.1);
    font-size: 0.9rem;
    flex: 1;
    outline: none;
  }
  .add-btn {
    align-self: flex-end;
    padding: 5px 20px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(to right, #81d4fa, #f48fb1);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
    transform: translateY(-107px);
  }

  .add-btn-tr {
    align-self: flex-end;
    padding: 5px 20px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(to right, #81d4fa, #f48fb1);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
    transform: translateY(-165px);
  }

  .entry-display {
    background: rgba(255,255,255,0.6);
    padding: 20px;
    border-radius: 18px;
    backdrop-filter: blur(10px);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }

  th, td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid #eee;
    border: none;
  }

  th {
    background: #f0f4f8;
    border-radius: 14px;
    color:#a484c4;
    gap: 10px;
  }

  td {
    color: #4dabf5;
    font-weight:1000;
  }

  .allocator-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}


  .summary-grid-wrapper {
    display: flex;
    flex-direction: row;
    gap: 26px;
  }

  .summary-grid {
    display: grid;
    flex-direction: row-reverse;
    grid-template-columns: repeat(4, 1fr);
    gap: 30px;
  }
  
  

  .summary-card {
    background: rgba(255, 255, 255, 0.8);
    padding: 16px 24px;
    border-radius: 14px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.05);
    text-align: center;
    color:#a484c4;
    font-weight: 750;
    border: 1px solid rgba(0, 0, 0, 0.05);
    min-width: 146px;
  }

  .summary-card span {
    display: block;
    font-size: 1.3rem;
    font-weight: 800;
    color: #4dabf5;
  }

  .allocator {
    background: rgba(255,255,255,0.7);
    padding: 24px;
    border-radius: 18px;
    backdrop-filter: blur(10px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.06);
  }

  .allocator label {
    display: block;
    margin: 12px 0 6px;
    font-weight: 600;
  }

  .allocator select, .allocator input {
    width: 100%;
    margin-bottom: 12px;
  }

  .allocator button {
    padding: 10px 18px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(to right, #4dabf5, #ec407a);
    color: #fff;
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 12px;
  }

  .pill-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-top: 20px;
}

.pill {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 20px;
  padding: 12px;
  text-align: center;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.1);
  position: relative;
  font-size: 0.85rem;
}

.pill-fill {
  height: 10px;
  border-radius: 5px;
  margin-top: 8px;
  transition: width 0.4s ease;
}

.pill-transportation { background: linear-gradient(to right, #a0dab2, #d0efc1); }
.pill-grocery        { background: linear-gradient(to right, #9cd3a9, #cdeec9); }
.pill-food           { background: linear-gradient(to right, #b2e4bc, #e5f6d2); }
.pill-academic       { background: linear-gradient(to right, #a9dfbb, #daf4ce); }

.pill-family         { background: linear-gradient(to right, #a0dab2, #d0efc1); }
.pill-leisure        { background: linear-gradient(to right, #9cd3a9, #cdeec9); }
.pill-emergency      { background: linear-gradient(to right, #b2e4bc, #e5f6d2); }
.pill-miscellaneous  { background: linear-gradient(to right, #a9dfbb, #daf4ce); }

.pill-healthcare     { background: linear-gradient(to right, #a0dab2, #d0efc1); }
.pill-utilities      { background: linear-gradient(to right, #9cd3a9, #cdeec9); }
.pill-donation       { background: linear-gradient(to right, #b2e4bc, #e5f6d2); }
.pill-savings        { background: linear-gradient(to right, #a9dfbb, #daf4ce); }

.tracker-duo {
  display: flex;
  flex-direction: row;
  gap: 20px;
  flex-wrap: wrap;
}

.tracker-duo .card-box {
  width: 40%;
  max-width: 500px;
}

.weekly-tracker {
      background: rgba(255, 255, 255, 0.55);
    backdrop-filter: blur(15px);
    border-radius: 25px;
    padding: 25px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.08);
    border: 1px solid rgba(255,255,255,0.25);
  flex: 1;
  min-width: 0;

}

.tracker-header {
  font-size: 18px;
  font-weight: 800;
  color: #4dabf5;
  margin-bottom: 10px;
}

.barseg-week {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.barseg-item {
  display: flex;
  align-items: center;
  gap: 7px;
}

.expense-seg {
  justify-content: flex-start;
}

.savings-seg {
  justify-content: flex-end;
}

.barseg-label {
  width: 40px;
  font-size: 15px;
  font-weight: 750;
  color:#a484c4;
  transform: translateY(-2px);
}

.barseg-bar {
  flex: 1;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 25px;
  overflow: hidden;
  height: 16px;
}

.barseg-fill {
  height: 100%;
  border-radius: 25px;
  transition: width 0.3s ease-in-out;
}

.barseg-sav {
  background: linear-gradient(to right, #a8e6cf, #dcedc1); /* pastel green */
}

.barseg-exp {
  background: linear-gradient(to right, #b3cde0, #fbb1bd); /* pastel blue-pink */
}




.amount-input-group {
  margin-bottom: 5px;
}

.input-with-buttons {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 5px;
}

.input-with-buttons input[type="number"] {
  flex: 1;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #ccc;
}

.input-with-buttons button {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background-color: #5a9;
  color: white;
  cursor: pointer;
  transition: background 0.3s ease;
}

.input-with-buttons button:hover {
  background-color: #48a;
}


  /* Category-based column cards */
  .category-column {
    background: rgba(255, 255, 255, 0.55);
    backdrop-filter: blur(12px);
    border-radius: 20px;
    padding: 24px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.07);
    border: 1px solid rgba(255,255,255,0.2);
  }

  @media (max-width: 900px) {
    .top-row, .bottom-row {
      grid-template-columns: 1fr;
    }
  }
</style>

</head>
<body>
  <div class="title-with-home">
  <h1><?= htmlspecialchars($first_name) ?>'s Finance Tracker</h1>
  <button class="home-btn" onclick="window.location.href='https://vibeboard.alwaysdata.net/VibeBoard/financetracker/financedashboard.php'">
        <i class="fa-solid fa-house"></i>
   </button>
</div>

  <div class="dashboard">

    <!-- TOP ROW: Add Entry & View Entries -->
    <div class="top-row">

      <!-- Add Entry Card -->
      <div class="card-box">
        <div class="logo-text"><h2 class="h2-text">➕ Add Entry</h2>
  </div>
        <div class="entry-type-buttons">
          <button data-type="allowance">Allowance</button>
          <button data-type="expense">Expense</button>
          <button data-type="savings">Savings</button>
          <button data-type="goal">Goal</button>
        </div>

        <!-- Allowance Form -->
        <form id="allowance-form" class="form-section">
          <div class="form-row">
            <input type="hidden" name="allowance_id" value="some_valid_id">
            <input type="number" name="allowance_amount" placeholder="Allowance Amount" required />
            <input type="date" name="entry_date" required />
            <select name="allocation" required>
              <option value="" disabled selected>Allocate To</option>
              <option value="initial">Initial Allowance</option>
              <option value="expenses">Expenses</option>
              <option value="savings">Savings</option>
            </select>
          </div>
          <button type="submit" class="add-btn">Add Allowance</button>
        </form>

        <!-- Expense Form -->
        <form id="expense-form" class="form-section">
          <div class="form-row">
            <input type="number" name="expense_amount" placeholder="Expense Amount" max="<?= $availableBalance ?>" required />
            <input type="date" name="entry_date" required />
            <select name="category" required>
              <option value="" disabled selected>Select Category</option>
              <option value="transportation">Transportation</option>
              <option value="grocery">Grocery</option>
              <option value="food">Food</option>
              <option value="academic">Academic</option>
              <option value="family">Family</option>
              <option value="leisure">Leisure</option>
              <option value="emergency">Emergency</option>
              <option value="miscellaneous">Miscellaneous</option>
              <option value="healthcare">Healthcare</option>
              <option value="utilities">Utilities</option>
              <option value="donation">Donation</option>
            </select>
          </div>
          <button type="submit" class="add-btn">Add Expense</button>
        </form>

        <!-- Savings Form -->
        <form id="savings-form" class="form-section">
          <div class="form-row">
            <input type="number" name="savings_amount" placeholder="Savings Amount" max="<?= $availableBalance ?>" required />
            <input type="date" name="entry_date" required />
            <select name="goal_id" required>
  <option value="" disabled selected>Linked Goal</option>
  <?php foreach ($goalOptions as $goal): ?>
    <option value="<?= htmlspecialchars($goal['goal_id']) ?>">
      <?= htmlspecialchars($goal['goal_name']) ?>
    </option>
  <?php endforeach; ?>
</select>
            <select name="category" required>
              <option value="" disabled selected>Savings Category</option>
              <option value="Emergency Fund">Emergency Fund</option>
              <option value="Travel">Travel</option>
              <option value="Gift">Gift</option>
              <option value="Investment">Investment</option>
              <option value="Wishlist">Wishlist</option>
              <option value="Future Allocation">Future Allocation</option>
            </select>
          </div>
          <button type="submit" class="add-btn-tr">Add Savings</button>
        </form>

        <!-- Goal Form -->
        <form id="goal-form" class="form-section">
          <div class="form-row">
            <input type="hidden" name="goal_id">
            <input type="text" name="goal_name" placeholder="Goal Name" required />
            <input type="number" name="wishlist_amount" placeholder="Target Amount" required />
            <select name="wishlist_category" required>
              <option value="" disabled selected>Wishlist Category</option>
              <option value="gadgets">Gadgets</option>
              <option value="travel">Travel</option>
              <option value="education">Education</option>
              <option value="fashion">Fashion</option>
              <option value="hobbies">Hobbies</option>
              <option value="emergency">Emergency</option>
              <option value="gifts">Gifts</option>
              <option value="others">Others</option>
            </select>
          </div>
          <button type="submit" class="add-btn">Add Goal</button>
        </form>
      </div>

      <!-- View Entries Card -->
      <div class="card-box">
         <div class="logo-text"><h2 class="h2-text">📂 View Entries</h2>
  </div>
        <div class="filter-buttons">
          <button class="filter-btn" data-show="allowance">Allowance</button>
          <button class="filter-btn" data-show="expense">Expenses</button>
          <button class="filter-btn" data-show="savings">Savings</button>
          <button class="filter-btn" data-show="goal">Goals</button>
        </div>

        <div class="entry-display">
          <table>
            <thead id="entry-thead"></thead>
            <tbody id="entry-body"></tbody>
          </table>
        </div>
      </div>
    </div>

<!-- BOTTOM ROW: Summary + Smart Allocator -->
<div class="bottom-row">

  <!-- LEFT PANEL: Summary + Weekly Trackers -->
  <div class="left-panel">

    <!-- 2x2 Summary Grid -->
    <div class="summary-grid">
      <div class="summary-card">
        Allowance<br><span id="total-allowance">₱0.00</span>
      </div>
      <div class="summary-card">
        Expenses<br><span id="total-expense">₱0.00</span>
      </div>
      <div class="summary-card">
        Savings<br><span id="total-savings">₱0.00</span>
      </div>
      <div class="summary-card">
        Remaining<br><span id="remaining">₱0.00</span>
      </div>
    </div>

    <!-- Weekly Trackers (2 Columns) -->
    <div class="tracker-duo">

      <!-- Weekly Expense Tracker -->
      <div class="card-box weekly-tracker" id="expense-pills">
        <h3 class="tracker-header">Week Expenses: ₱<span id="week-expense-total">
  <?= number_format($week_expense_total, 2) ?>
</span></h3>
        <div class="barseg-week">
          <?php
            $days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
            foreach ($days as $i => $day):
          ?>
            <div class="barseg-item expense-seg">
              <span class="barseg-label"><?= $day ?></span>
              <div class="barseg-bar">
                <div class="barseg-fill barseg-exp" id="exp-barseg-<?= $i ?>"></div>
              </div>
            </div>
          <?php endforeach; ?>
        </div>
      </div>

      <!-- Weekly Savings Tracker -->
      <div class="card-box weekly-tracker" id="savings-pills">
        <h3 class="tracker-header">Week Savings: ₱<span id="week-savings-total">
  <?= number_format($week_savings_total, 2) ?>
</span></h3>
        <div class="barseg-week">
          <?php foreach ($days as $i => $day): ?>
            <div class="barseg-item savings-seg">
              <span class="barseg-label"><?= $day ?></span>
              <div class="barseg-bar">
                <div class="barseg-fill barseg-sav" id="sav-barseg-<?= $i ?>"></div>
              </div>
            </div>
          <?php endforeach; ?>
        </div>
      </div>

    </div> <!-- End tracker-duo -->
  </div> <!-- End left-panel -->


  <!-- RIGHT PANEL: Smart Allocation Calculator -->
  <div class="card-box allocator">
    <div class="logo-text">
      <h2 class="h2-text">Smart Allocation Calculator</h2>
    </div>

    <?php
      $categories = [
        'Transportation', 'Grocery', 'Food', 'Academic', 'Family', 'Leisure',
        'Emergency', 'Miscellaneous', 'Healthcare', 'Utilities', 'Donation', 'Savings'
      ];
    ?>

    <!-- Input Amount -->
    <div class="amount-input-group">
      <label for="sim-amount"></label>
      <div class="input-with-buttons">
        <input type="number" id="sim-amount" placeholder="Enter Desired Allowance Amount" />
        <button id="calc-btn">🧮 Calculate</button>
        <button id="refresh-btn">🔄 Refresh</button>
      </div>
    </div>

    <!-- Category Allocation Inputs -->
    <div id="allocator-inputs" class="allocator-grid">
      <?php foreach ($categories as $cat): ?>
        <div>
          <label style="color:#a484c4"><h5><?= $cat ?></h5></label>
          <input type="number" class="sim-expense" data-category="<?= $cat ?>" placeholder="%" />
        </div>
      <?php endforeach; ?>
    </div>

    <!-- Allocation Result Display -->
    <div id="sim-result" style="display:none;">
      <p style="color:#a484c4"><strong>Total Allocated: ₱<span id="sim-total-val">0</span></strong></p>
      <div id="sim-breakdown" class="pill-grid"></div>
    </div>

  </div> <!-- End allocator -->

</div> <!-- End bottom-row -->



  </div>

<script>
const entryBtns = document.querySelectorAll('.entry-type-buttons button');
const filterBtns = document.querySelectorAll('.filter-btn');
const sections = document.querySelectorAll('.form-section');
const thead = document.getElementById('entry-thead');
const tbody = document.getElementById('entry-body');
const remSpan = document.getElementById('remaining');

const totals = { allowance: 0, expense: 0, savings: 0 };
let data = { allowance: [], expense: [], savings: [], goal: [] };
let currentForm = null, currentFilter = null;

function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return `₱${num.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function updateTotals() {
  const allowanceVal = parseFloat(totals.allowance) || 0;
  const expenseVal = parseFloat(totals.expense) || 0;
  const savingsVal = parseFloat(totals.savings) || 0;

  document.getElementById('total-allowance').textContent = formatCurrency(allowanceVal);
  document.getElementById('total-expense').textContent = formatCurrency(expenseVal);
  document.getElementById('total-savings').textContent = formatCurrency(savingsVal);

  const remaining = allowanceVal - expenseVal - savingsVal;
  if (remSpan) remSpan.textContent = formatCurrency(remaining);
}

function updateWeeklyPills() {
  const now = new Date();
  const past7 = new Date();
  past7.setDate(now.getDate() - 6);

  const isWithin7Days = dateStr => {
    const d = new Date(dateStr);
    return d >= past7 && d <= now;
  };

  const expenses7d = data.expense.filter(e => isWithin7Days(e.entry_date));
  const savings7d = data.savings.filter(s => isWithin7Days(s.entry_date));

  const dailyTotals = entries => {
    const totals = Array(7).fill(0);
    entries.forEach(e => {
      const d = new Date(e.entry_date);
      const weekday = (d.getDay() + 6) % 7;
      totals[weekday] += parseFloat(e.amount) || 0;
    });
    return totals;
  };

  const expenseTotals = dailyTotals(expenses7d);
  const savingsTotals = dailyTotals(savings7d);

  const maxExpense = Math.max(...expenseTotals, 1);
  const maxSavings = Math.max(...savingsTotals, 1);

  let totalExpenseSum = 0;
  let totalSavingsSum = 0;

  for (let i = 0; i < 7; i++) {
    const expFill = document.getElementById(`exp-barseg-${i}`);
    const savFill = document.getElementById(`sav-barseg-${i}`);
    const expVal = expenseTotals[i];
    const savVal = savingsTotals[i];

    const expPercent = Math.round((expVal / maxExpense) * 100);
    const savPercent = Math.round((savVal / maxSavings) * 100);

    if (expFill) expFill.style.width = `${expPercent}%`;
    if (savFill) savFill.style.width = `${savPercent}%`;

    totalExpenseSum += expVal;
    totalSavingsSum += savVal;
  }

  document.getElementById("week-expense-total").textContent = totalExpenseSum.toFixed(2);
  document.getElementById("week-savings-total").textContent = totalSavingsSum.toFixed(2);
}

entryBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    const form = document.getElementById(`${type}-form`);
    const isActive = currentForm === type;

    currentForm = isActive ? null : type;
    sections.forEach(s => s.classList.remove('active'));
    entryBtns.forEach(b => b.classList.remove('active'));

    if (!isActive) {
      form.classList.add('active');
      btn.classList.add('active');
    }
  });
});

async function fetchData(type) {
  const formData = new FormData();
  formData.append('action', 'load');
  formData.append('type', type);

  try {
    const res = await fetch('financetracker.php', { method: 'POST', body: formData });
    const text = await res.text();

    console.log(`Raw response for ${type}:`, text); // Debug: Raw response before JSON parse

    try {
      const json = JSON.parse(text);
      console.log(`Parsed JSON for ${type}:`, json); // Debug: Parsed object structure

      data[type] = json;

      totals[type] = json.reduce((sum, entry) => {
        if (type === 'goal') return sum + (+entry.wishlist_amount || 0);
        return sum + (+entry.amount || 0);
      }, 0);

    } catch (e) {
      console.error(`❌ Invalid JSON for ${type}:`, text);
      console.error(`⛔ JSON parse error for ${type}:`, e);
    }

  } catch (err) {
    console.error(`🚫 Fetch failed for ${type}:`, err);
  }
}

['allowance', 'expense', 'savings', 'goal'].forEach(type => {
  const form = document.getElementById(`${type}-form`);
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const formData = new FormData(form);
    formData.append('action', 'update');
    formData.append('type', type);

    try {
      const res = await fetch('financetracker.php', { method: 'POST', body: formData });
      const text = await res.text();

      try {
        const saved = JSON.parse(text);
        if (saved?.id || saved?.goal_id || saved?.saving_id) {
         await fetchData(type);
  updateTotals();
  updateTable(type);
  updateWeeklyPills();
  await refreshGoalDropdown();
  form.reset();
        } else {
          console.error(`Unexpected response for ${type} submission:`, saved);
        }
      } catch (err) {
        console.error(`Invalid JSON on save response for ${type}:`, text);
      }
    } catch (err) {
      console.error(`Failed to save ${type} entry:`, err);
    }
  });
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.show;
    const isSame = currentFilter === type;

    currentFilter = isSame ? null : type;
    filterBtns.forEach(b => b.classList.remove('active'));
    if (!isSame) btn.classList.add('active');

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!isSame) {
      await fetchData(type);
      updateTotals();
      updateTable(type);
      updateWeeklyPills();
      await refreshGoalDropdown();
    }
  });
});
async function refreshGoalDropdown() {
  try {
    const formData = new FormData();
    formData.append('action', 'get_goal_options');
    formData.append('type', 'goal');

    const res = await fetch('financetracker.php', { method: 'POST', body: formData });
    const goalOptions = await res.json();

    const goalSelect = document.querySelector('#savings-form select[name="goal_id"]');
    if (!goalSelect) return;

    // Clear existing options
    goalSelect.innerHTML = `<option value="" disabled selected>Linked Goal</option>`;

    goalOptions.forEach(goal => {
      const opt = document.createElement('option');
      opt.value = goal.goal_id;
      opt.textContent = goal.goal_name;
      goalSelect.appendChild(opt);
    });

  } catch (err) {
    console.error("Failed to refresh goal dropdown:", err);
  }
}
function updateTable(type) {
  thead.innerHTML = '';
  tbody.innerHTML = '';

  console.log(`🚨 Updating table for: ${type}`);
  console.log(`📦 Data for ${type}:`, data[type]);

  const headers = {
    allowance: ['Date', 'Amount', 'Allocation'],
    expense:   ['Date', 'Amount', 'Category'],
    savings:   ['Date', 'Amount', 'Goal'],
    goal:      ['Goal', 'Target', 'Category']
  }[type];

  if (!headers || !data[type]) {
    console.warn(`⚠️ No headers or data defined for type: ${type}`);
    return;
  }

  thead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}<th>Actions</th></tr>`;

  if (data[type].length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="${headers.length + 1}" style="text-align:center; color:#4dabf5">No data available</td>`;
    tbody.appendChild(row);
    return;
  }

  data[type].forEach((item, idx) => {
    let cells = [];

    if (type === 'allowance') {
      cells = [
        item.entry_date || '—',
        formatCurrency(item.amount),
        item.allocation || '—'
      ];
    } else if (type === 'expense') {
      cells = [
        item.entry_date || '—',
        formatCurrency(item.amount),
        item.category || '—'
      ];
    } else if (type === 'savings') {
      const goalLabel = item.goal_name || `Goal #${item.goal_id}` || '—';
      cells = [
        item.entry_date || '—',
        formatCurrency(item.amount),
        goalLabel
      ];
    } else if (type === 'goal') {
      cells = [
        item.goal_name || '—',
        formatCurrency(item.wishlist_amount),
        item.wishlist_category || '—'
      ];
    }

    const row = document.createElement('tr');
    row.dataset.index = idx;
    row.dataset.type = type;
    row.innerHTML =
      cells.map((val, i) => `<td data-field="${i}">${val}</td>`).join('') +
      `<td class="action-cell">
         <button class="edit-btn">✏️</button>
         <button class="save-btn" style="display:none">💾</button>
         <button class="delete-btn">🗑️</button>
       </td>`;
    tbody.appendChild(row);
  });

  bindRowEvents();
}




function bindRowEvents() {
  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
  const row = btn.closest('tr');
  const type = row.dataset.type;

  row.querySelectorAll('td[data-field]').forEach((td, i) => {
    const val = td.textContent.trim().replace(/₱|,/g, '');

    // Dropdown logic for specific fields
    if (
      (type === 'expense' && i === 2) || 
      (type === 'allowance' && i === 2) ||
      (type === 'goal' && i === 2) ||
      (type === 'savings' && i === 2)
    ) {
      let categories = [];

      if (type === 'expense') {
        categories = [
          'transportation', 'grocery', 'food', 'academic', 'family',
          'leisure', 'emergency', 'miscellaneous', 'healthcare',
          'utilities', 'donation'
        ];
      } else if (type === 'allowance') {
        categories = ['initial allowance', 'expenses', 'savings'];
      } else if (type === 'goal') {
        categories = [
          'gadgets', 'travel', 'education', 'fashion',
          'hobbies', 'emergency', 'gifts', 'others'
        ];
      } else if (type === 'savings') {
        categories = [
          'Emergency Fund', 'Travel', 'Gift', 
          'Investment', 'Wishlist', 'Future Allocation'
        ];
      }

      const select = document.createElement('select');
      categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        if (val === cat) option.selected = true;
        select.appendChild(option);
      });
      td.innerHTML = '';
const wrapper = document.createElement('div');
wrapper.className = 'cell-edit';
wrapper.appendChild(select);
td.appendChild(wrapper);
    } else {
      td.innerHTML = `<div class="cell-edit"><input type="text" value="${val}" /></div>`;
    }
  });
      btn.style.display = 'none';
      row.querySelector('.save-btn').style.display = 'inline-block';
    });
  });

  tbody.querySelectorAll('.save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const type = row.dataset.type;
      const index = +row.dataset.index;
      const inputs = row.querySelectorAll('input,select');
      const entry = data[type][index];

      const formData = new FormData();
      formData.append('action', 'save');
      formData.append('type', type);

      const entryId = entry.id;
      formData.append('id', entryId);

      if (type === 'goal') {
        formData.append('goal_id', entry.goal_id || entry.id);
        formData.append('goal_name', inputs[0].value);
        formData.append('wishlist_amount', inputs[1].value);
        formData.append('wishlist_category', inputs[2].value);
      } else {
        formData.append('entry_date', inputs[0].value);
        formData.append(`${type}_amount`, inputs[1].value);
        if (type === 'allowance') {
          formData.append('allocation', inputs[2].value);
        } else if (type === 'expense') {
          formData.append('category', inputs[2].value);
        } else if (type === 'savings') {
  formData.append('goal_id', entry.goal_id);
}
      }

      try {
        const res = await fetch('financetracker.php', { method: 'POST', body: formData });
        const updated = await res.json();
        data[type][index] = updated;
        await fetchData(type);
        updateTotals();
        updateTable(type);
        updateWeeklyPills();
        await refreshGoalDropdown();
      } catch (err) {
        console.error(`Failed to update ${type} row:`, err);
      }
    });
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const type = row.dataset.type;
      const index = +row.dataset.index;
      const entry = data[type][index];

      const formData = new FormData();
      formData.append('action', 'delete');
      formData.append('type', type);
      const entryId = entry.id;
      formData.append('id', entryId);

      try {
        await fetch('financetracker.php', { method: 'POST', body: formData });
        data[type].splice(index, 1);
        await fetchData(type);
        updateTotals();
        updateTable(type);
        updateWeeklyPills();
        await refreshGoalDropdown();
      } catch (err) {
        console.error(`Failed to delete ${type} entry:`, err);
      }
    });
  });
}

const calcBtn = document.getElementById('calc-btn');
const refreshBtn = document.getElementById('refresh-btn');
const simBreakdown = document.getElementById('sim-breakdown');
const simTotalVal = document.getElementById('sim-total-val');
const simInputs = document.querySelectorAll('.sim-expense');
const inputGrid = document.getElementById('allocator-inputs');
const simResult = document.getElementById('sim-result');
const simAmount = document.getElementById('sim-amount');

calcBtn?.addEventListener('click', () => {
  const amount = +simAmount.value || 0;
  simBreakdown.innerHTML = '';
  let total = 0;

  inputGrid.style.display = 'none';
  simResult.style.display = 'block';

  simInputs.forEach(input => {
    const percent = +input.value;
    const category = input.dataset.category;
    const value = Math.floor(amount * percent / 100);
    total += value;

    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.innerHTML = `
      <strong style="color:#a484c4">${category}</strong><br>
      <p style="color: #4dabf5; font-weight:650">${percent}% • ₱${value.toLocaleString()}</p>
      <div class="pill-fill pill-${category.toLowerCase().replace(/\s+/g, '')}" style="width: ${percent}%"></div>
    `;
    simBreakdown.appendChild(pill);
  });

  simTotalVal.textContent = total.toLocaleString();
});

refreshBtn?.addEventListener('click', () => {
  simAmount.value = '';
  simInputs.forEach(input => input.value = '');
  simBreakdown.innerHTML = '';
  simTotalVal.textContent = '0';
  inputGrid.style.display = 'grid';
  simResult.style.display = 'none';
});

async function initializeDashboard() {
  await Promise.all([
    fetchData('allowance'),
    fetchData('expense'),
    fetchData('savings'),
    fetchData('goal')
  ]);
  updateTotals();
  updateWeeklyPills();
  await refreshGoalDropdown();
}

window.addEventListener('DOMContentLoaded', initializeDashboard);
</script>




</body>
</html>
