<?php
session_start();
session_unset();
session_destroy();

// Redirect to login page in the Registration folder
header("Location: ../registration/login.php?message=loggedout");
exit();
?>