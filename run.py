#!/usr/bin/env python3
"""
LabSecure AI v2 — One-Click Full-Stack Launcher
=================================================
Run this single file to start EVERYTHING:
  1. Backend  (FastAPI on port 8000)
  2. Frontend (Vite dev server on port 5173)
  3. Ngrok    (public tunnel to frontend)

Press Ctrl+C to stop all services.
"""

import hashlib
import json
import os
import platform
import signal
import subprocess
import sys
import time
import urllib.request

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    # --- Re-invoke via project venv on Windows if not already using it ---
    _project_root = os.path.dirname(os.path.abspath(__file__))
    _venv_python = os.path.join(_project_root, ".venv", "Scripts", "python.exe")
    if ".venv" not in sys.executable and os.path.exists(_venv_python):
        if "FORCE_VENV_RESTART" not in os.environ:
            print("[INFO] Re-invoking using project virtual environment...")
            os.environ["FORCE_VENV_RESTART"] = "1"
            os.execv(_venv_python, [_venv_python, __file__] + sys.argv[1:])
            sys.exit(0)

# ── Configuration ──────────────────────────────────────────
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
VENV_DIR = os.path.join(PROJECT_ROOT, ".venv")
REQUIREMENTS = os.path.join(PROJECT_ROOT, "requirements.txt")
HASH_FILE = os.path.join(VENV_DIR, ".requirements_hash")
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

BACKEND_HOST = "0.0.0.0"
BACKEND_PORT = 8000
FRONTEND_PORT = 5173

# Track child processes for clean shutdown
_processes = []
_ngrok_proc = None


def get_venv_python():
    """Return the path to the Python binary inside the venv."""
    if platform.system() == "Windows":
        return os.path.join(VENV_DIR, "Scripts", "python.exe")
    return os.path.join(VENV_DIR, "bin", "python")


def get_requirements_hash():
    """Compute a hash of requirements.txt to detect changes."""
    if not os.path.exists(REQUIREMENTS):
        return None
    with open(REQUIREMENTS, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def get_saved_hash():
    """Read the previously saved requirements hash."""
    if not os.path.exists(HASH_FILE):
        return None
    with open(HASH_FILE, "r") as f:
        return f.read().strip()


def save_hash(h):
    """Save the current requirements hash."""
    with open(HASH_FILE, "w") as f:
        f.write(h)


def ensure_venv():
    """Create the virtual environment if it doesn't exist."""
    if os.path.exists(get_venv_python()):
        return
    print("📦 Creating virtual environment...")
    subprocess.check_call([sys.executable, "-m", "venv", VENV_DIR])
    print("   ✓ Virtual environment created")


def check_python_version():
    """Warn users on Windows if they use an incompatible Python version."""
    if platform.system() == "Windows":
        v = sys.version_info
        if v.major != 3 or v.minor not in (10, 11, 12):
            print(f"\n⚠️  WARNING: You are running Python {v.major}.{v.minor}.")
            print("   It is highly recommended to use Python 3.11 on Windows to avoid setup errors")
            print("   with AI libraries (insightface, openvino, etc.) needing C++ Build Tools.\n")
            time.sleep(2)  # Give them a moment to read


def ensure_requirements():
    """Install requirements only if they've changed since last install."""
    current_hash = get_requirements_hash()
    if current_hash is None:
        print("⚠️  No requirements.txt found, skipping dependency install")
        return

    saved_hash = get_saved_hash()
    if current_hash == saved_hash:
        print("✓ Dependencies up to date")
        return

    print("📥 Installing/updating dependencies...")
    venv_python = get_venv_python()
    
    if platform.system() == "Windows" and sys.version_info.major == 3 and sys.version_info.minor == 11:
        try:
            print("   -> Installing pre-compiled insightface wheel for Windows Python 3.11...")
            subprocess.check_call(
                [venv_python, "-m", "pip", "install", 
                 "https://huggingface.co/hanamizuki-ai/insightface-releases/resolve/main/insightface-0.7.3-cp311-cp311-win_amd64.whl", 
                 "-q"]
            )
        except subprocess.CalledProcessError as e:
            print(f"   ⚠️  Failed to install pre-compiled insightface wheel: {e}")

    # Remove CPU onnxruntime to avoid conflicts with onnxruntime-gpu
    subprocess.call([venv_python, "-m", "pip", "uninstall", "onnxruntime", "-y", "-q"])

    subprocess.check_call(
        [venv_python, "-m", "pip", "install", "-r", REQUIREMENTS, "-q"],
    )
    save_hash(current_hash)
    print("   ✓ Dependencies installed")


def get_lan_ipv4():
    """Best-effort LAN IPv4 for Pico / hardware clients (not 127.0.0.1)."""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.3)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    try:
        import socket as _s
        for info in _s.getaddrinfo(_s.gethostname(), None, _s.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127."):
                return ip
    except Exception:
        pass
    return None


def kill_port(port):
    """Kill any process listening on the given port."""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True, timeout=5,
        )
        pids = result.stdout.strip()
        if pids:
            for pid in pids.split("\n"):
                pid = pid.strip()
                if pid:
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            print(f"   ✓ Cleared port {port} (killed stale process)")
            time.sleep(0.5)
    except Exception:
        pass


def start_backend():
    """Launch the FastAPI backend with uvicorn."""
    kill_port(BACKEND_PORT)
    venv_python = get_venv_python()
    print(f"🏗️  Starting backend on http://localhost:{BACKEND_PORT}")
    
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    
    proc = subprocess.Popen(
        [
            venv_python, "-m", "uvicorn",
            "backend.main:app",
            "--host", BACKEND_HOST,
            "--port", str(BACKEND_PORT),
            "--reload",
            "--reload-dir", "backend",
        ],
        cwd=PROJECT_ROOT,
        env=env,
        preexec_fn=os.setsid if os.name == 'posix' else None,
    )
    _processes.append(proc)
    return proc


def start_frontend():
    """Launch the Vite dev server."""
    kill_port(FRONTEND_PORT)
    print(f"🌐 Starting frontend on http://localhost:{FRONTEND_PORT}")
    
    npm_cmd = "npm.cmd" if platform.system() == "Windows" else "npm"
    proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=FRONTEND_DIR,
        preexec_fn=os.setsid if os.name == 'posix' else None,
    )
    _processes.append(proc)
    return proc


def _ngrok_failure_hint(log_path: str) -> str:
    """Return a short hint if ngrok.log shows a known failure."""
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            log = f.read()
        if "not authenticated" in log or "ERR_NGROK_4018" in log:
            return (
                "Ngrok needs an authtoken. Run:\n"
                "      ngrok config add-authtoken YOUR_TOKEN\n"
                "   Get one at https://dashboard.ngrok.com/get-started/your-authtoken"
            )
    except Exception:
        pass
    return "See ngrok.log in the project root for details."


def start_ngrok():
    """Launch ngrok tunnel to the frontend (optional — failure won't stop other services)."""
    global _ngrok_proc
    kill_port(4040)  # ngrok admin port
    print("🚀 Starting ngrok tunnel (optional)...")
    log_path = os.path.join(PROJECT_ROOT, "ngrok.log")
    log_file = open(log_path, "w")
    
    # Prioritize local ngrok.exe if it exists
    ngrok_cmd = "ngrok"
    local_ngrok = os.path.join(PROJECT_ROOT, "ngrok.exe" if os.name != 'posix' else "ngrok")
    if os.path.exists(local_ngrok):
        ngrok_cmd = local_ngrok
        
    proc = subprocess.Popen(
        [ngrok_cmd, "http", str(FRONTEND_PORT)],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid if os.name == 'posix' else None,
    )
    _ngrok_proc = proc

    # Wait for ngrok to start and get the public URL
    for _ in range(10):
        if proc.poll() is not None:
            print("   ⚠️  Ngrok exited early — local dev will continue without a public URL.")
            print(f"   {_ngrok_failure_hint(log_path)}")
            _ngrok_proc = None
            return None
        time.sleep(1)
        try:
            req = urllib.request.Request("http://localhost:4040/api/tunnels")
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode())
                tunnels = data.get("tunnels", [])
                if tunnels:
                    url = tunnels[0]["public_url"]
                    print(f"   ✓ Public URL: {url}")
                    return proc
        except Exception:
            pass

    if proc.poll() is not None:
        print("   ⚠️  Ngrok exited — local dev will continue without a public URL.")
        print(f"   {_ngrok_failure_hint(log_path)}")
        _ngrok_proc = None
        return None

    print("   ⚠️  Ngrok started but couldn't fetch URL. Check http://localhost:4040")
    return proc


def shutdown(signum=None, frame=None):
    """Gracefully stop all services."""
    print("\n\n🛑 Shutting down all services...")
    all_procs = list(_processes)
    if _ngrok_proc is not None:
        all_procs.append(_ngrok_proc)
    for proc in reversed(all_procs):
        try:
            if os.name == 'posix':
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            else:
                # Windows proc.terminate() kills only the parent process
                # We need to kill the process tree to avoid orphan Uvicorn workers
                subprocess.call(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                proc.terminate()
        except Exception:
            pass
            
    # Wait max 6 seconds for graceful exit
    start_wait = time.time()
    for proc in reversed(all_procs):
        while proc.poll() is None and time.time() - start_wait < 6:
            time.sleep(0.1)

    for proc in reversed(all_procs):
        if proc.poll() is None:
            try:
                if os.name == 'posix':
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                else:
                    proc.kill()
            except Exception:
                pass
                
    print("👋 All services stopped. Goodbye!")
    sys.exit(0)


if __name__ == "__main__":
    os.chdir(PROJECT_ROOT)

    print("=" * 55)
    print("  LabSecure AI v2 — Full-Stack Launcher")
    print("=" * 55)
    print()

    # Handle Ctrl+C gracefully
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        # Step 1: Ensure environment
        check_python_version()
        ensure_venv()
        ensure_requirements()
        print()

        # Step 2: Start all services
        start_backend()
        time.sleep(2)  # Give backend a moment to start

        start_frontend()
        time.sleep(2)  # Give frontend a moment to start

        start_ngrok()

        print()
        print("=" * 55)
        print("  ✅ All services running!")
        print(f"  Backend:  http://localhost:{BACKEND_PORT}")
        print(f"  Frontend: http://localhost:{FRONTEND_PORT}")
        lan_ip = get_lan_ipv4()
        if lan_ip:
            print(f"  LAN IP:   {lan_ip}  ← set this in pico_servo_control.py BACKEND_URL")
            print(f"  Pico API: http://{lan_ip}:{BACKEND_PORT}/api/doors/hardware/state")
        if _ngrok_proc is not None and _ngrok_proc.poll() is None:
            print("  Ngrok:    Check URL above")
        else:
            print("  Ngrok:    skipped (optional — local URLs work fine)")
        print()
        print("  Press Ctrl+C to stop everything")
        print("=" * 55)

        ngrok_exit_warned = False

        # Keep the script alive; only backend/frontend exits are fatal
        while True:
            for proc in _processes:
                if proc.poll() is not None:
                    print(f"\n⚠️  A service exited unexpectedly (PID {proc.pid})")
                    shutdown()
            if (
                not ngrok_exit_warned
                and _ngrok_proc is not None
                and _ngrok_proc.poll() is not None
            ):
                ngrok_exit_warned = True
                print("\n⚠️  Ngrok stopped (backend and frontend still running).")
            time.sleep(1)

    except KeyboardInterrupt:
        shutdown()
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error: {e}")
        shutdown()
