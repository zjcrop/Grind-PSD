import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / ".github" / "scripts" / "ingest_psd_result.py"
SPEC = importlib.util.spec_from_file_location("ingest_psd_result", SCRIPT)
ingest = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ingest)


def valid_payload():
    return {
        "schemaVersion": "3.0.0",
        "standardId": "grind-psd-sieve-v1",
        "id": "gpsd-test-12345678",
        "user": {"id": "test-user", "name": "测试用户"},
        "grinder": {
            "brand": "Test",
            "model": "G1",
            "setting": "18",
            "settingTurns": 2.25,
            "settingOrder": 18,
            "color": "#d98e32",
        },
        "sample": {
            "doseG": 10,
            "bean": "sample",
            "roastLevel": "浅烘",
            "method": "手动水平往复筛分",
            "durationSec": 60,
            "sieveDevice": "test sieve",
            "replicate": 1,
        },
        "weightsGrams": {
            "mesh18_retained_g": 0.1,
            "mesh24_retained_g": 0.8,
            "mesh35_retained_g": 5.2,
            "mesh60_retained_g": 2.7,
            "pan80_lt300_g": 1.2,
        },
        "totalG": 10,
        "notes": "",
        "license": "CC-BY-4.0",
        "createdAt": "2026-07-29T00:00:00Z",
    }


def register_payload(user_id="test-user", name="测试用户"):
    return {
        "operation": "register_user",
        "schemaVersion": "3.0.0",
        "standardId": "grind-psd-sieve-v1",
        "user": {"id": user_id, "name": name},
        "requestedAt": "2026-07-29T00:00:00Z",
    }


def batch_payload(*records):
    return {
        "operation": "upsert_records",
        "schemaVersion": "3.0.0",
        "standardId": "grind-psd-sieve-v1",
        "license": "CC-BY-4.0",
        "records": list(records),
        "requestedAt": "2026-07-29T00:00:00Z",
    }


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / "data" / "users").mkdir(parents=True)
        (root / "data" / "database.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "3.0.0",
                    "standardId": "grind-psd-sieve-v1",
                    "updatedAt": "2026-07-29T00:00:00Z",
                    "userCount": 0,
                    "recordCount": 0,
                    "users": {},
                    "records": [],
                }
            ),
            encoding="utf-8",
        )
        self.old_database_path = ingest.DATABASE_PATH
        self.old_users_dir = ingest.USERS_DIR
        ingest.DATABASE_PATH = root / "data" / "database.json"
        ingest.USERS_DIR = root / "data" / "users"

    def tearDown(self):
        ingest.DATABASE_PATH = self.old_database_path
        ingest.USERS_DIR = self.old_users_dir
        self.temp.cleanup()

    def test_normalizes_and_writes_both_databases(self):
        record = ingest.validate_and_normalize(
            valid_payload(), "github-tester", "42"
        )
        self.assertEqual(record["metrics"]["quality"]["grade"], "A")
        self.assertEqual(record["metrics"]["finesPct"], 12)
        self.assertEqual(record["grinder"]["settingTurns"], 2.25)
        self.assertFalse(ingest.update_database(record))

        database = json.loads(ingest.DATABASE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(database["recordCount"], 1)
        self.assertEqual(database["userCount"], 1)
        self.assertEqual(
            database["users"]["test-user"]["githubLogin"], "github-tester"
        )

        user_path = ingest.USERS_DIR / "test-user.json"
        user_database = json.loads(user_path.read_text(encoding="utf-8"))
        self.assertEqual(user_database["recordCount"], 1)
        self.assertEqual(
            user_database["records"][0]["submission"]["issueNumber"], 42
        )

    def test_duplicate_is_idempotent(self):
        record = ingest.validate_and_normalize(
            valid_payload(), "github-tester", "42"
        )
        self.assertFalse(ingest.update_database(record))
        self.assertTrue(ingest.update_database(record))

    def test_rejects_poor_mass_balance(self):
        payload = valid_payload()
        payload["sample"]["doseG"] = 20
        with self.assertRaisesRegex(ingest.ValidationError, "above the 10%"):
            ingest.validate_and_normalize(payload, "github-tester", "42")

    def test_rejects_user_id_hijack(self):
        record = ingest.validate_and_normalize(
            valid_payload(), "github-tester", "42"
        )
        ingest.update_database(record)
        second = valid_payload()
        second["id"] = "gpsd-test-87654321"
        second_record = ingest.validate_and_normalize(
            second, "different-account", "43"
        )
        with self.assertRaisesRegex(ingest.ValidationError, "already bound"):
            ingest.update_database(second_record)

    def test_registration_is_unique_and_creates_empty_user_database(self):
        result = ingest.process_operation(
            register_payload(), "github-tester", "42"
        )
        self.assertEqual(result["action"], "register_user")
        self.assertFalse(result["duplicate"])
        duplicate = ingest.process_operation(
            register_payload(), "github-tester", "43"
        )
        self.assertTrue(duplicate["duplicate"])
        with self.assertRaisesRegex(ingest.ValidationError, "already bound"):
            ingest.process_operation(
                register_payload(), "different-account", "44"
            )

        database = json.loads(ingest.DATABASE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(database["userCount"], 1)
        self.assertEqual(database["recordCount"], 0)
        user_database = json.loads(
            (ingest.USERS_DIR / "test-user.json").read_text(encoding="utf-8")
        )
        self.assertEqual(user_database["recordCount"], 0)
        self.assertEqual(user_database["ownerGithubLogin"], "github-tester")

    def test_batch_update_and_delete_require_owner(self):
        ingest.process_operation(register_payload(), "github-tester", "42")
        first = valid_payload()
        second = valid_payload()
        second["id"] = "gpsd-test-87654321"
        second["grinder"]["setting"] = "20"
        result = ingest.process_operation(
            batch_payload(first, second), "github-tester", "43"
        )
        self.assertEqual(result["record_count"], 2)
        self.assertFalse(result["duplicate"])

        edited = valid_payload()
        edited["weightsGrams"] = {
            "mesh18_retained_g": 0.2,
            "mesh24_retained_g": 1.0,
            "mesh35_retained_g": 5.0,
            "mesh60_retained_g": 2.6,
            "pan80_lt300_g": 1.2,
        }
        update = {
            "operation": "update_record",
            "schemaVersion": "3.0.0",
            "standardId": "grind-psd-sieve-v1",
            "targetId": edited["id"],
            "record": edited,
        }
        with self.assertRaisesRegex(ingest.ValidationError, "already bound"):
            ingest.process_operation(update, "different-account", "44")
        changed = ingest.process_operation(update, "github-tester", "45")
        self.assertFalse(changed["duplicate"])

        delete = {
            "operation": "delete_record",
            "schemaVersion": "3.0.0",
            "standardId": "grind-psd-sieve-v1",
            "userId": "test-user",
            "targetId": "gpsd-test-12345678",
        }
        with self.assertRaisesRegex(ingest.ValidationError, "already bound"):
            ingest.process_operation(delete, "different-account", "46")
        removed = ingest.process_operation(delete, "github-tester", "47")
        self.assertFalse(removed["duplicate"])
        database = json.loads(ingest.DATABASE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(database["recordCount"], 1)
        user_database = json.loads(
            (ingest.USERS_DIR / "test-user.json").read_text(encoding="utf-8")
        )
        self.assertEqual(user_database["recordCount"], 1)


if __name__ == "__main__":
    unittest.main()
