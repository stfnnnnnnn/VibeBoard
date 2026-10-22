-- VibeBoard database schema (structure only, no data).
-- Import into an empty MySQL/MariaDB database:  mysql -u <user> -p <database> < database/schema.sql
-- The app also creates or upgrades some tables on demand (src/lib/migrate.ts).


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `activities` (
  `activity_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_subject_id` int(11) DEFAULT NULL,
  `activity_name` varchar(100) NOT NULL,
  `activity_type` enum('Seatwork','Performance Task','Take-Home Activity','Laboratory Activity','Technical Assessment') NOT NULL,
  `urgency` enum('High','Medium','Low') NOT NULL,
  `status` enum('Pending','Done') DEFAULT 'Pending',
  `date_created` date DEFAULT curdate(),
  `deadline` date DEFAULT NULL,
  `grade` decimal(5,2) DEFAULT NULL,
  `score` decimal(5,2) DEFAULT NULL,
  `items` decimal(5,2) DEFAULT NULL,
  `accomplished_at` date DEFAULT NULL,
  PRIMARY KEY (`activity_id`),
  KEY `fk_activities_user_subject` (`user_subject_id`),
  CONSTRAINT `fk_activities_user_subject` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER trg_update_activity_status
BEFORE INSERT ON activities
FOR EACH ROW
BEGIN
  IF NEW.score IS NOT NULL AND NEW.items IS NOT NULL AND NEW.grade IS NOT NULL THEN
    SET NEW.status = 'Done';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER trg_update_activity_status_on_update
BEFORE UPDATE ON activities
FOR EACH ROW
BEGIN
  IF NEW.score IS NOT NULL AND NEW.items IS NOT NULL AND NEW.grade IS NOT NULL THEN
    SET NEW.status = 'Done';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `allocation_template_items` (
  `item_id` int(11) NOT NULL AUTO_INCREMENT,
  `template_id` int(11) NOT NULL,
  `category` varchar(50) NOT NULL,
  `priority_tier` enum('required','target','flexible') NOT NULL DEFAULT 'flexible',
  `allocation_type` enum('fixed','percent') NOT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `percent` decimal(5,2) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`item_id`),
  KEY `template_id` (`template_id`),
  CONSTRAINT `allocation_template_items_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `allocation_templates` (`template_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `allocation_templates` (
  `template_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(60) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_allowance_amount` decimal(10,2) DEFAULT NULL,
  `last_period_start` date DEFAULT NULL,
  `last_period_end` date DEFAULT NULL,
  PRIMARY KEY (`template_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `allocation_templates_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `allowance` (
  `allowance_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `entry_date` date NOT NULL,
  `allowance_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `categories` enum('initial allowance','expenses','savings') NOT NULL,
  `status` enum('planned','actual') NOT NULL DEFAULT 'actual',
  `recurring_rule_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`allowance_id`),
  KEY `user_id` (`user_id`),
  KEY `recurring_rule_id` (`recurring_rule_id`),
  CONSTRAINT `allowance_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`),
  CONSTRAINT `allowance_ibfk_2` FOREIGN KEY (`recurring_rule_id`) REFERENCES `recurring_rules` (`rule_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_activity_bank` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `connection_id` int(11) NOT NULL,
  `course_id` int(11) NOT NULL,
  `canvas_assignment_id` bigint(20) NOT NULL,
  `name` varchar(255) NOT NULL,
  `due_at` datetime DEFAULT NULL,
  `points_possible` decimal(8,2) DEFAULT NULL,
  `html_url` varchar(500) DEFAULT NULL,
  `submission_status` varchar(50) DEFAULT NULL,
  `submission_score` decimal(8,2) DEFAULT NULL,
  `submission_submitted_at` datetime DEFAULT NULL,
  `canvas_updated_at` datetime NOT NULL,
  `bank_status` enum('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
  `first_seen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_synced_at` datetime NOT NULL,
  `last_change_at` datetime DEFAULT NULL,
  `last_seen_sync_run_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_conn_assignment` (`connection_id`,`canvas_assignment_id`),
  KEY `course_id` (`course_id`),
  CONSTRAINT `canvas_activity_bank_ibfk_1` FOREIGN KEY (`connection_id`) REFERENCES `canvas_connections` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_activity_bank_ibfk_2` FOREIGN KEY (`course_id`) REFERENCES `canvas_courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_announcement_bank` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `connection_id` int(11) NOT NULL,
  `course_id` int(11) NOT NULL,
  `canvas_announcement_id` bigint(20) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text DEFAULT NULL,
  `html_url` varchar(500) DEFAULT NULL,
  `posted_at` datetime DEFAULT NULL,
  `canvas_updated_at` datetime NOT NULL,
  `bank_status` enum('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
  `first_seen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_synced_at` datetime NOT NULL,
  `last_seen_sync_run_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_conn_announcement` (`connection_id`,`canvas_announcement_id`),
  KEY `course_id` (`course_id`),
  CONSTRAINT `canvas_announcement_bank_ibfk_1` FOREIGN KEY (`connection_id`) REFERENCES `canvas_connections` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_bank_ibfk_2` FOREIGN KEY (`course_id`) REFERENCES `canvas_courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_announcement_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `announcement_id` int(11) NOT NULL,
  `activity_id` int(11) DEFAULT NULL,
  `quiz_id` int(11) DEFAULT NULL,
  `exam_id` int(11) DEFAULT NULL,
  `grade_entry_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `workboard_item_id` int(11) DEFAULT NULL,
  `schedule_override_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `activity_id` (`activity_id`),
  KEY `quiz_id` (`quiz_id`),
  KEY `exam_id` (`exam_id`),
  KEY `grade_entry_id` (`grade_entry_id`),
  KEY `workboard_item_id` (`workboard_item_id`),
  KEY `schedule_override_id` (`schedule_override_id`),
  KEY `announcement_id` (`announcement_id`),
  CONSTRAINT `canvas_announcement_links_ibfk_2` FOREIGN KEY (`activity_id`) REFERENCES `activities` (`activity_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_links_ibfk_3` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`quiz_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_links_ibfk_4` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_links_ibfk_5` FOREIGN KEY (`grade_entry_id`) REFERENCES `grade_entries` (`entry_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_links_ibfk_6` FOREIGN KEY (`workboard_item_id`) REFERENCES `workboard_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_links_ibfk_7` FOREIGN KEY (`schedule_override_id`) REFERENCES `schedule_overrides` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_announcement_links_ibfk_8` FOREIGN KEY (`announcement_id`) REFERENCES `canvas_announcement_bank` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_one_destination` CHECK ((`activity_id` is not null) + (`quiz_id` is not null) + (`exam_id` is not null) + (`grade_entry_id` is not null) + (`workboard_item_id` is not null) + (`schedule_override_id` is not null) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_connections` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `base_url` varchar(255) NOT NULL,
  `canvas_user_id` bigint(20) NOT NULL,
  `canvas_user_name` varchar(255) DEFAULT NULL,
  `access_token_enc` varbinary(1024) DEFAULT NULL,
  `token_iv` varbinary(16) DEFAULT NULL,
  `token_tag` varbinary(16) DEFAULT NULL,
  `status` enum('active','invalid','disconnected') NOT NULL DEFAULT 'active',
  `last_sync_at` datetime DEFAULT NULL,
  `last_sync_status` enum('success','partial','failed') DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `token_expires_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user` (`user_id`),
  CONSTRAINT `canvas_connections_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_courses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `connection_id` int(11) NOT NULL,
  `canvas_course_id` bigint(20) NOT NULL,
  `name` varchar(255) NOT NULL,
  `course_code` varchar(100) DEFAULT NULL,
  `term` varchar(100) DEFAULT NULL,
  `workflow_state` varchar(30) DEFAULT NULL,
  `start_at` datetime DEFAULT NULL,
  `end_at` datetime DEFAULT NULL,
  `mapping_status` enum('pending','linked','created','ignored') NOT NULL DEFAULT 'pending',
  `user_subject_id` int(11) DEFAULT NULL,
  `first_seen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_seen_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_conn_course` (`connection_id`,`canvas_course_id`),
  KEY `user_subject_id` (`user_subject_id`),
  CONSTRAINT `canvas_courses_ibfk_1` FOREIGN KEY (`connection_id`) REFERENCES `canvas_connections` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_courses_ibfk_2` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_entry_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bank_item_id` int(11) NOT NULL,
  `activity_id` int(11) DEFAULT NULL,
  `quiz_id` int(11) DEFAULT NULL,
  `exam_id` int(11) DEFAULT NULL,
  `grade_entry_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_bank_item` (`bank_item_id`),
  KEY `activity_id` (`activity_id`),
  KEY `quiz_id` (`quiz_id`),
  KEY `exam_id` (`exam_id`),
  KEY `grade_entry_id` (`grade_entry_id`),
  CONSTRAINT `canvas_entry_links_ibfk_1` FOREIGN KEY (`bank_item_id`) REFERENCES `canvas_activity_bank` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_entry_links_ibfk_2` FOREIGN KEY (`activity_id`) REFERENCES `activities` (`activity_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_entry_links_ibfk_3` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`quiz_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_entry_links_ibfk_4` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_entry_links_ibfk_5` FOREIGN KEY (`grade_entry_id`) REFERENCES `grade_entries` (`entry_id`) ON DELETE CASCADE,
  CONSTRAINT `CONSTRAINT_1` CHECK ((`activity_id` is not null) + (`quiz_id` is not null) + (`exam_id` is not null) + (`grade_entry_id` is not null) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_pairing_codes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `code` char(43) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_code` (`code`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `canvas_pairing_codes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_sync_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `connection_id` int(11) NOT NULL,
  `bank_item_id` int(11) DEFAULT NULL,
  `event_type` enum('course_discovered','assignment_created','due_date_changed','score_changed','submission_status_changed','assignment_removed') NOT NULL,
  `old_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_data`)),
  `new_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`new_data`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `connection_id` (`connection_id`),
  KEY `bank_item_id` (`bank_item_id`),
  CONSTRAINT `canvas_sync_events_ibfk_1` FOREIGN KEY (`connection_id`) REFERENCES `canvas_connections` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_sync_events_ibfk_2` FOREIGN KEY (`bank_item_id`) REFERENCES `canvas_activity_bank` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `canvas_sync_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `connection_id` int(11) NOT NULL,
  `trigger_source` enum('cron','manual') NOT NULL,
  `started_at` datetime NOT NULL,
  `finished_at` datetime DEFAULT NULL,
  `status` enum('running','success','partial','failed') NOT NULL DEFAULT 'running',
  `courses_synced` int(11) NOT NULL DEFAULT 0,
  `items_fetched` int(11) NOT NULL DEFAULT 0,
  `items_changed` int(11) NOT NULL DEFAULT 0,
  `errors_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`errors_json`)),
  PRIMARY KEY (`id`),
  KEY `connection_id` (`connection_id`),
  CONSTRAINT `canvas_sync_runs_ibfk_1` FOREIGN KEY (`connection_id`) REFERENCES `canvas_connections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `category_budgets` (
  `budget_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `template_id` int(11) DEFAULT NULL,
  `category` varchar(50) NOT NULL,
  `type` enum('expense','savings') NOT NULL DEFAULT 'expense',
  `period` enum('weekly','monthly') NOT NULL DEFAULT 'monthly',
  `period_start` date DEFAULT NULL,
  `period_end` date DEFAULT NULL,
  `cap_amount` decimal(10,2) NOT NULL CHECK (`cap_amount` >= 0),
  `plan_amount` decimal(10,2) DEFAULT NULL,
  `is_override` tinyint(1) NOT NULL DEFAULT 0,
  `override_reason` varchar(255) DEFAULT NULL,
  `tier` enum('required','target','flexible') DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`budget_id`),
  KEY `user_id` (`user_id`),
  KEY `category_budgets_template_fk` (`template_id`),
  CONSTRAINT `category_budgets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `category_budgets_template_fk` FOREIGN KEY (`template_id`) REFERENCES `allocation_templates` (`template_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `exams` (
  `exam_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_subject_id` int(11) DEFAULT NULL,
  `exam_name` varchar(100) NOT NULL,
  `exam_type` enum('Midterm','Final Exam') NOT NULL,
  `urgency` enum('High','Medium','Low') NOT NULL,
  `status` enum('Pending','In Progress','Done') DEFAULT 'Pending',
  `date_created` date DEFAULT curdate(),
  `deadline` date DEFAULT NULL,
  `grade` decimal(5,2) DEFAULT NULL,
  `score` decimal(5,2) DEFAULT 0.00,
  `items` decimal(5,2) DEFAULT 1.00,
  `accomplished_at` date DEFAULT NULL,
  PRIMARY KEY (`exam_id`),
  KEY `fk_exams_user_subject` (`user_subject_id`),
  CONSTRAINT `fk_exams_user_subject` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER trg_update_exam_status
BEFORE INSERT ON exams
FOR EACH ROW
BEGIN
  IF NEW.score IS NOT NULL AND NEW.items IS NOT NULL AND NEW.grade IS NOT NULL THEN
    SET NEW.status = 'Done';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER trg_update_exam_status_on_update
BEFORE UPDATE ON exams
FOR EACH ROW
BEGIN
  IF NEW.score IS NOT NULL AND NEW.items IS NOT NULL AND NEW.grade IS NOT NULL THEN
    SET NEW.status = 'Done';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `expenses` (
  `expense_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `category` enum('transportation','grocery','food','academic','family','leisure','emergency','miscellaneous','healthcare','utilities','donation') NOT NULL,
  `expense_amount` decimal(10,2) NOT NULL CHECK (`expense_amount` >= 0),
  `entry_date` date NOT NULL,
  `status` enum('planned','actual') NOT NULL DEFAULT 'actual',
  `recurring_rule_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`expense_id`),
  KEY `user_id` (`user_id`),
  KEY `recurring_rule_id` (`recurring_rule_id`),
  CONSTRAINT `expenses_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`),
  CONSTRAINT `expenses_ibfk_2` FOREIGN KEY (`recurring_rule_id`) REFERENCES `recurring_rules` (`rule_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `finance_wishlist` (
  `wish_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `category` varchar(40) NOT NULL DEFAULT 'leisure',
  `status` enum('open','bought','goal') NOT NULL DEFAULT 'open',
  `goal_id` int(11) DEFAULT NULL,
  `expense_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`wish_id`),
  KEY `idx_wishlist_user_status` (`user_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `grade_entries` (
  `entry_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_subject_id` int(11) NOT NULL,
  `cat_id` int(11) NOT NULL,
  `period_id` int(11) NOT NULL,
  `is_lab` tinyint(1) DEFAULT 0,
  `name` varchar(100) NOT NULL,
  `urgency` enum('High','Medium','Low') DEFAULT 'Medium',
  `status` enum('Pending','Done') DEFAULT 'Pending',
  `deadline` date DEFAULT NULL,
  `score` decimal(5,2) DEFAULT NULL,
  `items` decimal(5,2) DEFAULT NULL,
  `grade` decimal(5,2) DEFAULT NULL,
  `created_at` date DEFAULT curdate(),
  `accomplished_at` date DEFAULT NULL,
  PRIMARY KEY (`entry_id`),
  KEY `user_subject_id` (`user_subject_id`),
  KEY `cat_id` (`cat_id`),
  KEY `period_id` (`period_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `grade_settings` (
  `user_subject_id` int(11) NOT NULL,
  `class_standing_weight` decimal(5,2) DEFAULT 60.00,
  `activities_weight` decimal(5,2) DEFAULT 40.00,
  `quizzes_weight` decimal(5,2) DEFAULT 60.00,
  `exams_weight` decimal(5,2) DEFAULT 40.00,
  `midterm_weight` decimal(5,2) DEFAULT 15.00,
  `final_weight` decimal(5,2) DEFAULT 25.00,
  `lec_percentage` decimal(5,2) DEFAULT 70.00,
  `lab_percentage` decimal(5,2) DEFAULT 30.00,
  PRIMARY KEY (`user_subject_id`),
  CONSTRAINT `grade_settings_ibfk_1` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `grading_categories` (
  `cat_id` int(11) NOT NULL AUTO_INCREMENT,
  `period_id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `weight` decimal(5,2) NOT NULL,
  `is_singleton` tinyint(1) DEFAULT 0,
  `sort_order` tinyint(4) DEFAULT 0,
  `link_group` varchar(40) DEFAULT NULL,
  `collective_weight` decimal(5,2) DEFAULT NULL,
  `carry_score` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`cat_id`),
  KEY `period_id` (`period_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `grading_periods` (
  `period_id` int(11) NOT NULL AUTO_INCREMENT,
  `preset_id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `sort_order` tinyint(4) DEFAULT 0,
  PRIMARY KEY (`period_id`),
  KEY `preset_id` (`preset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `grading_presets` (
  `preset_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_default` tinyint(1) DEFAULT 0,
  `has_lab` tinyint(1) DEFAULT 0,
  `lec_weight` decimal(5,2) DEFAULT 100.00,
  `lab_weight` decimal(5,2) DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `grade_scale` varchar(10) NOT NULL DEFAULT '4pt',
  `final_period_id` int(11) DEFAULT NULL,
  `final_mode` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`preset_id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `habit_checkins` (
  `checkin_id` int(11) NOT NULL AUTO_INCREMENT,
  `habit_id` int(11) NOT NULL,
  `checkin_date` date NOT NULL,
  `is_completed` tinyint(1) DEFAULT 0,
  `amount` decimal(6,1) DEFAULT NULL,
  PRIMARY KEY (`checkin_id`),
  UNIQUE KEY `unique_checkin` (`habit_id`,`checkin_date`),
  CONSTRAINT `fk_checkin_habit` FOREIGN KEY (`habit_id`) REFERENCES `habit_tasks` (`habit_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `habit_pauses` (
  `pause_id` int(11) NOT NULL AUTO_INCREMENT,
  `habit_id` int(11) NOT NULL,
  `paused_at` date NOT NULL,
  `resumed_at` date DEFAULT NULL,
  PRIMARY KEY (`pause_id`),
  KEY `habit_id` (`habit_id`),
  CONSTRAINT `fk_pause_habit` FOREIGN KEY (`habit_id`) REFERENCES `habit_tasks` (`habit_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `habit_streaks` (
  `streak_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `habit_id` int(11) NOT NULL,
  `streak_start` date NOT NULL,
  `streak_end` date DEFAULT NULL,
  `current_streak_days` int(11) DEFAULT 1,
  `longest_streak` int(11) DEFAULT 1,
  PRIMARY KEY (`streak_id`),
  KEY `user_id` (`user_id`),
  KEY `habit_id` (`habit_id`),
  CONSTRAINT `habit_streaks_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `habit_streaks_ibfk_2` FOREIGN KEY (`habit_id`) REFERENCES `habit_tasks` (`habit_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `habit_tasks` (
  `habit_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `task_name` varchar(255) NOT NULL,
  `note` text DEFAULT NULL,
  `habit_urgency` enum('Urgent','Priority','Important','Not Important','Not Urgent') NOT NULL DEFAULT 'Not Urgent',
  `task_category` enum('academic','household','health','social','organizational','life goals') NOT NULL,
  `days_of_week` set('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  `times_per_week` tinyint(4) NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT current_timestamp(),
  `task_status` enum('active','archived','paused') NOT NULL DEFAULT 'active',
  `schedule_mode` enum('fixed','flexible') NOT NULL DEFAULT 'fixed',
  `tracking_type` enum('boolean','numeric') NOT NULL DEFAULT 'boolean',
  `target_value` decimal(6,1) DEFAULT NULL,
  `unit_label` varchar(24) DEFAULT NULL,
  `step_value` decimal(6,1) DEFAULT 1.0,
  `priority` enum('core','normal','optional') NOT NULL DEFAULT 'normal',
  `minimum_value` decimal(6,1) DEFAULT NULL,
  PRIMARY KEY (`habit_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `fk_habit_user` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `monthly_financial_summary` (
  `summary_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `month_year` varchar(20) NOT NULL,
  `total_expenses` decimal(10,2) DEFAULT 0.00,
  `total_savings` decimal(10,2) DEFAULT 0.00,
  `remaining_balance` decimal(10,2) DEFAULT 0.00,
  PRIMARY KEY (`summary_id`),
  UNIQUE KEY `user_id` (`user_id`,`month_year`),
  CONSTRAINT `monthly_financial_summary_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `programs` (
  `program_id` int(11) NOT NULL AUTO_INCREMENT,
  `program_name` varchar(100) NOT NULL,
  PRIMARY KEY (`program_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `quizzes` (
  `quiz_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_subject_id` int(11) DEFAULT NULL,
  `quiz_name` varchar(100) NOT NULL,
  `quiz_number` int(11) DEFAULT NULL,
  `urgency` enum('High','Medium','Low') NOT NULL,
  `status` enum('Pending','Done') DEFAULT 'Pending',
  `date_created` date DEFAULT curdate(),
  `deadline` date DEFAULT NULL,
  `grade` decimal(5,2) DEFAULT NULL,
  `score` decimal(5,2) DEFAULT NULL,
  `items` decimal(5,2) DEFAULT NULL,
  `accomplished_at` date DEFAULT NULL,
  PRIMARY KEY (`quiz_id`),
  KEY `fk_quizzes_user_subject` (`user_subject_id`),
  CONSTRAINT `fk_quizzes_user_subject` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER trg_update_quiz_status
BEFORE INSERT ON quizzes
FOR EACH ROW
BEGIN
  IF NEW.score IS NOT NULL AND NEW.items IS NOT NULL AND NEW.grade IS NOT NULL THEN
    SET NEW.status = 'Done';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER trg_update_quiz_status_on_update
BEFORE UPDATE ON quizzes
FOR EACH ROW
BEGIN
  IF NEW.score IS NOT NULL AND NEW.items IS NOT NULL AND NEW.grade IS NOT NULL THEN
    SET NEW.status = 'Done';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `recurring_rules` (
  `rule_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `type` enum('allowance','expense','savings') NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `goal_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL CHECK (`amount` >= 0),
  `frequency` enum('weekly','biweekly','monthly') NOT NULL,
  `day_of_week` tinyint(4) DEFAULT NULL,
  `day_of_month` tinyint(4) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `next_run_date` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`rule_id`),
  KEY `user_id` (`user_id`),
  KEY `goal_id` (`goal_id`),
  CONSTRAINT `recurring_rules_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `recurring_rules_ibfk_2` FOREIGN KEY (`goal_id`) REFERENCES `savings_goals` (`goal_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `savings_entries` (
  `saving_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `goal_id` int(11) NOT NULL,
  `savings_amount` decimal(10,2) NOT NULL CHECK (`savings_amount` >= 0),
  `entry_date` date NOT NULL,
  `categories` enum('Emergency Fund','Travel','Gift','Investment','Wishlist','Future Allocation') NOT NULL,
  `status` enum('planned','actual') NOT NULL DEFAULT 'actual',
  `recurring_rule_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`saving_id`),
  KEY `user_id` (`user_id`),
  KEY `goal_id` (`goal_id`),
  KEY `recurring_rule_id` (`recurring_rule_id`),
  CONSTRAINT `savings_entries_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`),
  CONSTRAINT `savings_entries_ibfk_2` FOREIGN KEY (`goal_id`) REFERENCES `savings_goals` (`goal_id`),
  CONSTRAINT `savings_entries_ibfk_3` FOREIGN KEY (`recurring_rule_id`) REFERENCES `recurring_rules` (`rule_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `savings_goals` (
  `goal_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `goal_name` varchar(100) NOT NULL,
  `wishlist_amount` decimal(10,2) NOT NULL CHECK (`wishlist_amount` >= 0),
  `target_date` date DEFAULT NULL,
  `wishlist_category` enum('gadgets','travel','education','fashion','hobbies','emergency','gifts','others') NOT NULL DEFAULT 'others',
  `entry_date` date NOT NULL DEFAULT curdate(),
  PRIMARY KEY (`goal_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `savings_goals_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `schedule_blocks` (
  `block_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `user_subject_id` int(11) DEFAULT NULL,
  `course_code` varchar(20) NOT NULL,
  `section` varchar(30) DEFAULT NULL,
  `instructor` varchar(150) DEFAULT NULL,
  `day_of_week` tinyint(4) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `venue` varchar(100) DEFAULT NULL,
  `meeting_link` varchar(500) DEFAULT NULL,
  `is_online` tinyint(1) DEFAULT 0,
  `modality` enum('face_to_face','online_sync','online_async') NOT NULL DEFAULT 'face_to_face',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`block_id`),
  KEY `user_id` (`user_id`),
  KEY `user_subject_id` (`user_subject_id`),
  CONSTRAINT `schedule_blocks_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `schedule_blocks_ibfk_2` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `schedule_overrides` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `block_id` int(11) NOT NULL,
  `override_date` date NOT NULL,
  `modality` enum('online_sync','online_async','cancelled','rescheduled') DEFAULT NULL,
  `note` text DEFAULT NULL,
  `room` varchar(100) DEFAULT NULL,
  `source_type` enum('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
  `source_announcement_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `moved_date` date DEFAULT NULL,
  `moved_start_time` time DEFAULT NULL,
  `moved_end_time` time DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_block_date` (`block_id`,`override_date`),
  KEY `source_announcement_id` (`source_announcement_id`),
  CONSTRAINT `schedule_overrides_ibfk_1` FOREIGN KEY (`block_id`) REFERENCES `schedule_blocks` (`block_id`) ON DELETE CASCADE,
  CONSTRAINT `schedule_overrides_ibfk_2` FOREIGN KEY (`source_announcement_id`) REFERENCES `canvas_announcement_bank` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `specializations` (
  `specialization_id` int(11) NOT NULL AUTO_INCREMENT,
  `program_id` int(11) NOT NULL,
  `specialization_name` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`specialization_id`),
  KEY `program_id` (`program_id`),
  CONSTRAINT `specializations_ibfk_1` FOREIGN KEY (`program_id`) REFERENCES `programs` (`program_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `studypulse_projection_prefs` (
  `user_subject_id` int(11) NOT NULL,
  `pref_key` varchar(48) NOT NULL,
  `value` decimal(6,2) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_subject_id`,`pref_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `subject_grading` (
  `user_subject_id` int(11) NOT NULL,
  `preset_id` int(11) NOT NULL,
  `has_lab` tinyint(1) DEFAULT 0,
  `lec_weight` decimal(5,2) DEFAULT 100.00,
  `lab_weight` decimal(5,2) DEFAULT 0.00,
  PRIMARY KEY (`user_subject_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `subjects` (
  `subject_id` int(11) NOT NULL AUTO_INCREMENT,
  `course_code` varchar(20) NOT NULL,
  `subject_name` varchar(100) NOT NULL,
  `units` int(11) NOT NULL DEFAULT 0,
  `year_level` enum('1st Year','2nd Year','3rd Year','4th Year') NOT NULL,
  `trimester` enum('1st Trimester','2nd Trimester','3rd Trimester') NOT NULL,
  `academic_year` varchar(50) DEFAULT NULL,
  `section` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`subject_id`),
  UNIQUE KEY `course_code` (`course_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER `set_academic_year_before_insert` BEFORE INSERT ON `subjects` FOR EACH ROW BEGIN
  IF NEW.year_level = '1st Year' THEN
    SET NEW.academic_year = 'AY 2023-2024';
  ELSEIF NEW.year_level = '2nd Year' THEN
    SET NEW.academic_year = 'AY 2024-2025';
  ELSEIF NEW.year_level = '3rd Year' THEN
    SET NEW.academic_year = 'AY 2025-2026';
  ELSEIF NEW.year_level = '4th Year' THEN
    SET NEW.academic_year = 'AY 2026-2027';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `trimesters` (
  `trimester_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `ay_start_year` int(11) DEFAULT NULL,
  `ay_end_year` int(11) DEFAULT NULL,
  `term_system` enum('Semestral','Trimestral','Quarterly') DEFAULT 'Trimestral',
  `trimester_name` varchar(50) DEFAULT NULL,
  `academic_year` varchar(50) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`trimester_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `trimesters_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `user_login` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) NOT NULL,
  `surname` varchar(100) NOT NULL,
  `dateofbirth` date DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `year_level` enum('1st Year','2nd Year','3rd Year','4th Year') NOT NULL,
  `status` enum('Regular','Irregular') NOT NULL,
  `program` int(11) NOT NULL,
  `specialization` int(11) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `reset_token` varchar(255) DEFAULT NULL,
  `reset_token_expiry` datetime DEFAULT NULL,
  `failed_attempts` int(11) NOT NULL DEFAULT 0,
  `last_attempt` datetime DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email_unique` (`email`),
  KEY `program` (`program`),
  KEY `specialization` (`specialization`),
  CONSTRAINT `user_login_ibfk_1` FOREIGN KEY (`program`) REFERENCES `programs` (`program_id`),
  CONSTRAINT `user_login_ibfk_2` FOREIGN KEY (`specialization`) REFERENCES `specializations` (`specialization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `user_subjects` (
  `user_subject_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `is_irregular` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`user_subject_id`),
  KEY `user_id` (`user_id`),
  KEY `subject_id` (`subject_id`),
  CONSTRAINT `user_subjects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`),
  CONSTRAINT `user_subjects_ibfk_2` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_entry_meta` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `activity_id` int(11) DEFAULT NULL,
  `quiz_id` int(11) DEFAULT NULL,
  `exam_id` int(11) DEFAULT NULL,
  `grade_entry_id` int(11) DEFAULT NULL,
  `in_progress` tinyint(1) NOT NULL DEFAULT 0,
  `estimated_hours` decimal(5,2) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `deadline_time` time DEFAULT NULL,
  `work_stage` varchar(24) DEFAULT NULL,
  `blocked_reason` varchar(255) DEFAULT NULL,
  `blocked_since` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_activity` (`activity_id`),
  UNIQUE KEY `uniq_quiz` (`quiz_id`),
  UNIQUE KEY `uniq_exam` (`exam_id`),
  UNIQUE KEY `uniq_grade_entry` (`grade_entry_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `workboard_entry_meta_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_entry_meta_ibfk_2` FOREIGN KEY (`activity_id`) REFERENCES `activities` (`activity_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_entry_meta_ibfk_3` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`quiz_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_entry_meta_ibfk_4` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_entry_meta_ibfk_5` FOREIGN KEY (`grade_entry_id`) REFERENCES `grade_entries` (`entry_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_meta_one_entry` CHECK ((`activity_id` is not null) + (`quiz_id` is not null) + (`exam_id` is not null) + (`grade_entry_id` is not null) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_item_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `work_item_id` int(11) DEFAULT NULL,
  `activity_id` int(11) DEFAULT NULL,
  `quiz_id` int(11) DEFAULT NULL,
  `exam_id` int(11) DEFAULT NULL,
  `grade_entry_id` int(11) DEFAULT NULL,
  `label` varchar(120) NOT NULL,
  `url` varchar(2048) NOT NULL,
  `link_type` enum('canvas','drive','docs','github','figma','website','portal','form','other') NOT NULL DEFAULT 'other',
  `position` smallint(6) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_link_work_item` (`work_item_id`),
  KEY `idx_link_user` (`user_id`),
  KEY `activity_id` (`activity_id`),
  KEY `quiz_id` (`quiz_id`),
  KEY `exam_id` (`exam_id`),
  KEY `grade_entry_id` (`grade_entry_id`),
  CONSTRAINT `workboard_item_links_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_item_links_ibfk_2` FOREIGN KEY (`work_item_id`) REFERENCES `workboard_work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_item_links_ibfk_3` FOREIGN KEY (`activity_id`) REFERENCES `activities` (`activity_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_item_links_ibfk_4` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`quiz_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_item_links_ibfk_5` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_item_links_ibfk_6` FOREIGN KEY (`grade_entry_id`) REFERENCES `grade_entries` (`entry_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_link_one_owner` CHECK ((`work_item_id` is not null) + (`activity_id` is not null) + (`quiz_id` is not null) + (`exam_id` is not null) + (`grade_entry_id` is not null) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `user_subject_id` int(11) DEFAULT NULL,
  `item_type` enum('event','reminder') NOT NULL,
  `title` varchar(255) NOT NULL,
  `location` varchar(255) DEFAULT NULL,
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `remind_at` datetime DEFAULT NULL,
  `note` text DEFAULT NULL,
  `source_type` enum('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
  `source_announcement_id` int(11) DEFAULT NULL,
  `status` enum('active','dismissed','done') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `user_subject_id` (`user_subject_id`),
  KEY `source_announcement_id` (`source_announcement_id`),
  CONSTRAINT `workboard_items_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_items_ibfk_2` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE SET NULL,
  CONSTRAINT `workboard_items_ibfk_3` FOREIGN KEY (`source_announcement_id`) REFERENCES `canvas_announcement_bank` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_organizations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_org_name` (`user_id`,`name`),
  CONSTRAINT `workboard_organizations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_projects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `color` varchar(16) DEFAULT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `context` enum('academic','project','organization') NOT NULL DEFAULT 'project',
  `user_subject_id` int(11) DEFAULT NULL,
  `organization_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_project_name` (`user_id`,`name`),
  KEY `fk_project_subject` (`user_subject_id`),
  KEY `fk_project_org` (`organization_id`),
  CONSTRAINT `fk_project_org` FOREIGN KEY (`organization_id`) REFERENCES `workboard_organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_subject` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_subtasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `work_item_id` int(11) DEFAULT NULL,
  `activity_id` int(11) DEFAULT NULL,
  `quiz_id` int(11) DEFAULT NULL,
  `exam_id` int(11) DEFAULT NULL,
  `grade_entry_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `is_done` tinyint(1) NOT NULL DEFAULT 0,
  `position` smallint(6) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_subtask_work_item` (`work_item_id`),
  KEY `idx_subtask_user` (`user_id`),
  KEY `activity_id` (`activity_id`),
  KEY `quiz_id` (`quiz_id`),
  KEY `exam_id` (`exam_id`),
  KEY `grade_entry_id` (`grade_entry_id`),
  CONSTRAINT `workboard_subtasks_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_subtasks_ibfk_2` FOREIGN KEY (`work_item_id`) REFERENCES `workboard_work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_subtasks_ibfk_3` FOREIGN KEY (`activity_id`) REFERENCES `activities` (`activity_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_subtasks_ibfk_4` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`quiz_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_subtasks_ibfk_5` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_subtasks_ibfk_6` FOREIGN KEY (`grade_entry_id`) REFERENCES `grade_entries` (`entry_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_subtask_one_owner` CHECK ((`work_item_id` is not null) + (`activity_id` is not null) + (`quiz_id` is not null) + (`exam_id` is not null) + (`grade_entry_id` is not null) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `workboard_work_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `category` enum('academic','project','organization','life') NOT NULL,
  `project_id` int(11) DEFAULT NULL,
  `user_subject_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `note` text DEFAULT NULL,
  `priority` enum('high','normal','low') NOT NULL DEFAULT 'normal',
  `work_status` enum('todo','in_progress','done') NOT NULL DEFAULT 'todo',
  `due_at` datetime DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `estimated_hours` decimal(5,2) DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `life_area` enum('personal','household','errands','finance','health','other') DEFAULT NULL,
  `organization_id` int(11) DEFAULT NULL,
  `deadline_time` time DEFAULT NULL,
  `work_stage` varchar(24) DEFAULT NULL,
  `blocked_reason` varchar(255) DEFAULT NULL,
  `blocked_since` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`work_status`),
  KEY `project_id` (`project_id`),
  KEY `user_subject_id` (`user_subject_id`),
  KEY `fk_item_org` (`organization_id`),
  CONSTRAINT `fk_item_org` FOREIGN KEY (`organization_id`) REFERENCES `workboard_organizations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `workboard_work_items_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_login` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `workboard_work_items_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `workboard_projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `workboard_work_items_ibfk_3` FOREIGN KEY (`user_subject_id`) REFERENCES `user_subjects` (`user_subject_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

