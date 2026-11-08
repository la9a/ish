import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("diagnose", Path(__file__).parents[1] / "scripts" / "diagnose.py")
diagnose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnose)


class DiagnosticTests(unittest.TestCase):
    def test_credentials_never_appear_in_environment_report(self):
        raw = b"AGENT_TOKEN=must-not-appear\0PASSWORD=must-not-appear\0API_HASH=must-not-appear\0USE_ALT=0\0SEND_NO_UPDATES=1\0PORT=8787\0"
        result = diagnose.safe_environment(raw)
        self.assertNotIn("must-not-appear", json.dumps(result))
        self.assertEqual(result, {"agent_token_present": True, "USE_ALT": False, "SEND_NO_UPDATES": True, "PORT": 8787})

    def test_unexpected_flag_values_are_not_copied(self):
        result = diagnose.safe_environment(b"PORT=must-not-appear\0NODE_ENV=must-not-appear\0")
        self.assertNotIn("must-not-appear", json.dumps(result))
        self.assertEqual(result["PORT"], "unexpected-format")

    def test_multiline_timing_log_keeps_metrics_and_drops_raw_data(self):
        result = diagnose.parse_log_tail("""
AGENT_TOKEN=must-not-appear
[linha-do-tempo] customer-phone-and-job-id {
  sinal: 'mensagem-admin',
  confirmacaoVia: 'propria-mensagem',
  confirmacaoMs: 24,
  sinalAteEscritaMs: 0.2,
  message: 'must-not-appear'
}
[event-loop] { p50: 10.2, p99: 30.4, max: 40, rssMB: 128 }
FLOOD_WAIT_3
""")
        self.assertEqual(result["samples"][0]["confirmacaoMs"], 24)
        self.assertEqual(result["samples"][0]["sinal"], "mensagem-admin")
        self.assertEqual(result["samples"][1]["p99"], 30.4)
        self.assertEqual(result["error_code_occurrences_in_tail"]["FLOOD_WAIT"], 1)
        self.assertNotIn("must-not-appear", json.dumps(result))
        self.assertNotIn("customer-phone-and-job-id", json.dumps(result))

    def test_unknown_string_fields_are_not_exported(self):
        result = diagnose.parse_log_tail('[linha-do-tempo] x {"sinal":"must-not-appear","envioMs":12,"token":"must-not-appear"}')
        self.assertNotIn("must-not-appear", json.dumps(result))
        self.assertEqual(result["samples"][0]["envioMs"], 12)

    def test_pm2_source_resolution_and_explicit_pid_in_custom_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            proc = root / "123"
            proc.mkdir()
            app = root / "custom-agent"
            app.mkdir()
            source = app / "server.mjs"
            source.write_text("// fake server")
            (proc / "cwd").symlink_to(app, target_is_directory=True)
            (proc / "cmdline").write_bytes(b"node\0/usr/lib/pm2/ProcessContainerFork.js\0")
            environment = b"pm_exec_path=" + str(source).encode() + b"\0AGENT_TOKEN=must-not-appear\0"
            self.assertIsNone(diagnose.source_path(proc, environment))
            self.assertEqual(diagnose.source_path(proc, environment, require_miami_name=False), source)


if __name__ == "__main__":
    unittest.main()
