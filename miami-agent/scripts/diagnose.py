#!/usr/bin/env python3
"""Read-only Miami diagnostics. No Telegram calls, session reads or service changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

LOG_LIMIT = 2 * 1024 * 1024
METRICS = ("confirmacaoMs", "sinalAteEscritaMs", "envioMs", "p50", "p99", "max", "rssMB")
SIGNALS = {"permissoes", "mensagem-membro", "mensagem-admin", "historico-admin", "reconciliacao", "horario", "sinal", "inicial", "peer"}


def safe_environment(raw):
    """Return only explicit non-secret flags and credential presence, never values."""
    result = {}
    for entry in raw.split(b"\0"):
        key, sep, value = entry.partition(b"=")
        if not sep:
            continue
        name = key.decode("utf-8", "replace")
        if name == "AGENT_TOKEN":
            result["agent_token_present"] = bool(value)
        elif name in {"USE_ALT", "SEND_NO_UPDATES"}:
            result[name] = value == b"1"
        elif name in {"PORT", "RECONCILE_MS", "JOB_TTL_MS"}:
            result[name] = int(value) if re.fullmatch(rb"\d{1,12}", value) else "unexpected-format"
        elif name == "NODE_ENV":
            result[name] = value.decode() if value in {b"production", b"development", b"test"} else "other"
    return result


def parse_log_tail(text):
    """Extract bounded numeric diagnostics; do not return raw lines or job identifiers."""
    samples = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        kind = next((name for name in ("linha-do-tempo", "event-loop") if f"[{name}]" in line), None)
        if kind is None:
            continue
        block = []
        for entry in lines[i:i + 40]:
            block.append(entry)
            if "}" in entry:
                break
        block = "\n".join(block)[:8192]
        sample = {"kind": kind}
        for key in METRICS:
            match = re.search(rf'(?<![\w])(?:"{key}"|{key})\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])', block)
            if match:
                value = float(match.group(1))
                if abs(value) <= 1e9:
                    sample[key] = value
        for key in ("sinal", "motivo", "confirmacaoVia"):
            match = re.search(rf'(?<![\w])(?:"{key}"|{key})\s*:\s*[\'\"]([^\'\"]{{1,40}})[\'\"]', block)
            allowed = SIGNALS if key != "confirmacaoVia" else {"random-id", "propria-mensagem"}
            if match and match.group(1) in allowed:
                sample[key] = match.group(1)
        if len(sample) > 1:
            samples.append(sample)
    errors = {code: text.count(code) for code in (
        "AUTH_KEY_DUPLICATED", "FLOOD_WAIT", "RANDOM_ID_DUPLICATE", "PEER_ID_INVALID", "CHAT_WRITE_FORBIDDEN",
    )}
    return {
        "samples": samples[-100:],
        "error_code_occurrences_in_tail": errors,
        "admin_debug_line_count_in_tail": text.count("[mensagem-gatilho]"),
        "flood_line_count_in_tail": text.count("[flood]"),
        "scope": "selected log tail only; missing samples do not establish health",
    }


def process_environment(proc):
    try:
        return (proc / "environ").read_bytes()
    except OSError:
        return b""


def source_path(proc, raw_environment, require_miami_name=True):
    try:
        cwd = (proc / "cwd").resolve(strict=True)
        args = (proc / "cmdline").read_bytes().decode("utf-8", "replace").split("\0")
    except OSError:
        return None
    candidates = []
    for arg in args:
        if arg.endswith(("server.mjs", "server.js")):
            candidates.append(arg)
        candidates.extend(re.findall(r"(/[A-Za-z0-9_./-]+/server\.(?:mjs|js))", arg))
    for entry in raw_environment.split(b"\0"):
        name, _, value = entry.partition(b"=")
        if name == b"pm_exec_path":
            candidates.append(value.decode("utf-8", "replace"))
    for value in candidates:
        path = Path(value)
        if not path.is_absolute():
            path = cwd / path
        if path.name in {"server.mjs", "server.js"} and (not require_miami_name or "miami" in str(path).lower()) and path.is_file():
            return path
    return None


def inspect_process(proc, source, environment):
    result = {"pid": int(proc.name), "flags": safe_environment(environment)}
    try:
        result["cwd"] = str((proc / "cwd").resolve(strict=True))
        binary = (proc / "exe").resolve(strict=True)
        version = subprocess.run([str(binary), "--version"], capture_output=True, text=True,
                                 timeout=3, env={"PATH": "/usr/bin:/bin"})
        result["node_version"] = version.stdout.strip() if re.fullmatch(r"v\d+\.\d+\.\d+\s*", version.stdout) else "unknown"
    except (OSError, subprocess.SubprocessError):
        result["node_version"] = "unavailable"
    try:
        status = (proc / "status").read_text()
        result["process_status"] = {k: int(v) for k, v in re.findall(r"^(VmRSS|VmSize|Threads):\s*(\d+)", status, re.M)}
    except OSError:
        result["process_status"] = "unavailable"
    if source.stat().st_size <= 2 * 1024 * 1024:
        content = source.read_bytes()
        text = content.decode("utf-8", "replace")
        result["source"] = {
            "path": str(source), "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content),
            "markers": {
                "shared_update_confirmation": "confirmSentUpdate(raw)" in text,
                "separate_admin_poll_cursor": "let pollCursor" in text,
                "admin_dispatch_telemetry": 'sinal: "mensagem-admin"' in text,
                "own_message_confirmation": "propria-mensagem" in text or "own.out" in text,
            },
        }
    return result


def collect(pid=None, explicit_logs=()):
    report = {
        "schema": 1, "collected_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "read_only": True, "telegram_requests": 0, "sessions_read": False,
        "host": {"kernel": os.uname().release, "cpu_count": os.cpu_count()},
        "processes": [], "logs": [], "unreadable_processes": 0,
    }
    try:
        report["host"]["load_average"] = list(os.getloadavg())
        report["host"]["uptime_seconds"] = float(Path("/proc/uptime").read_text().split()[0])
        memory = Path("/proc/meminfo").read_text()
        report["host"]["memory_kb"] = {k: int(v) for k, v in re.findall(r"^(MemTotal|MemAvailable):\s*(\d+)", memory, re.M)}
    except OSError:
        report["host"]["proc_metrics"] = "unavailable"
    tool = shutil.which("timedatectl")
    if tool:
        try:
            state = subprocess.run([tool, "show", "-p", "NTPSynchronized", "--value"], capture_output=True, text=True, timeout=3)
            report["host"]["ntp_synchronized"] = {"yes": True, "no": False}.get(state.stdout.strip())
        except subprocess.SubprocessError:
            report["host"]["ntp_synchronized"] = None
    logs = {Path(value) for value in explicit_logs}
    processes = [Path("/proc") / str(pid)] if pid else Path("/proc").glob("[0-9]*")
    for proc in processes:
        try:
            if (proc / "exe").resolve(strict=True).name not in {"node", "nodejs"}:
                continue
            environment = process_environment(proc)
            source = source_path(proc, environment, require_miami_name=pid is None)
            if source is None:
                continue
            report["processes"].append(inspect_process(proc, source, environment))
            for entry in environment.split(b"\0"):
                name, _, value = entry.partition(b"=")
                if name == b"pm_out_log_path" and value:
                    logs.add(Path(value.decode("utf-8", "replace")))
        except OSError:
            report["unreadable_processes"] += 1
    for path in sorted(logs):
        if not re.search(r"\.log(?:\.\d+)?$", path.name):
            report["logs"].append({"state": "skipped-non-log-path"})
            continue
        try:
            with path.open("rb") as handle:
                handle.seek(0, 2)
                size = handle.tell()
                handle.seek(max(0, size - LOG_LIMIT))
                text = handle.read(LOG_LIMIT).decode("utf-8", "replace")
            report["logs"].append({"path": str(path), "tail_bytes_max": LOG_LIMIT, "truncated": size > LOG_LIMIT, **parse_log_tail(text)})
        except OSError as error:
            report["logs"].append({"state": "unreadable", "error_type": type(error).__name__})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int)
    parser.add_argument("--log", action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    data = json.dumps(collect(args.pid, args.log), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(data)
        print("Diagnostic report created. No credentials or session contents included.")
    else:
        print(data, end="")
