# pico_servo_control.py
# MicroPython script for Raspberry Pi Pico W
#
# Wiring Instructions:
#   SG90 Servo Motor:
#     - Orange/Yellow (PWM/Signal) -> GP15 (Pin 20)
#     - Red (Power VCC) -> VBUS (Pin 40, 5V)  [prefer 5V — 3.3V is often too weak]
#     - Black/Brown (GND) -> GND (Any Ground Pin, e.g. Pin 38)
#
# Upload this file to your Raspberry Pi Pico W as main.py to run on boot.
#
# IMPORTANT: BACKEND_URL must be your laptop's current LAN IP on the SAME WiFi
# as the Pico (not localhost). Check with `ipconfig` (Windows) / `ip a` (Linux).

import network
import urequests
import time
from machine import Pin, PWM

# ── Configuration ──────────────────────────────────────────
WIFI_SSID = "David H."
WIFI_PASSWORD = "henriquez"
BACKEND_URL = "http://172.20.10.3:8000"

SERVO_PIN = 15  # GP15

# SG90 @ 50Hz (20ms period). duty_u16 = (pulse_ms / 20) * 65535
DUTY_LOCKED = 1638     # ~0.5ms  -> 0°
DUTY_UNLOCKED = 8192   # ~2.5ms  -> ~180° (large, visible travel)

POLL_INTERVAL_S = 1.0
# Re-assert servo PWM periodically while unlocked so a missed edge still moves it
REASSERT_EVERY_S = 3.0

# ── Hardware Setup ──────────────────────────────────────────
pwm = PWM(Pin(SERVO_PIN))
pwm.freq(50)

try:
    led = Pin("LED", Pin.OUT)
except Exception:
    led = None


def blink_led(times, interval):
    if not led:
        return
    for _ in range(times):
        led.toggle()
        time.sleep(interval)


def set_servo(duty, hold_s=1.2, keep_signal=False):
    """Drive servo to duty. keep_signal=True leaves PWM running (holds position)."""
    pwm.duty_u16(duty)
    time.sleep(hold_s)
    if not keep_signal:
        # Brief off only when locked — reduces idle buzz
        pwm.duty_u16(0)


def servo_boot_wiggle():
    """Visible proof the servo wiring/power works on startup."""
    print("Servo boot wiggle...")
    set_servo(DUTY_UNLOCKED, hold_s=1.0, keep_signal=True)
    time.sleep(0.3)
    set_servo(DUTY_LOCKED, hold_s=1.0, keep_signal=False)
    print("Boot wiggle done")


# ── WiFi Connection ─────────────────────────────────────────
wlan = network.WLAN(network.STA_IF)


def connect_wifi():
    print("Activating WiFi...")
    wlan.active(True)
    if not wlan.isconnected():
        print("Connecting to network:", WIFI_SSID)
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        timeout = 20
        while not wlan.isconnected() and timeout > 0:
            print("Waiting for connection...", timeout)
            blink_led(2, 0.1)
            time.sleep(0.8)
            timeout -= 1

    if wlan.isconnected():
        print("Connected to WiFi!")
        print("IP Address:", wlan.ifconfig()[0])
        if led:
            led.on()
    else:
        print("WiFi connection failed!")
        if led:
            led.off()


def http_get_json(url):
    res = None
    try:
        res = urequests.get(url)
        status = getattr(res, "status_code", 200)
        if status != 200:
            print("HTTP", status, "from", url)
            return None
        return res.json()
    except Exception as e:
        print("HTTP error:", e)
        return None
    finally:
        if res is not None:
            try:
                res.close()
            except Exception:
                pass


def check_door_status():
    """
    True  — unlocked (and no emergency)
    False — locked / emergency
    None  — backend unreachable
    """
    state = http_get_json(f"{BACKEND_URL}/api/doors/hardware/state")
    if state is None:
        return None
    if state.get("emergency_lock", False):
        print("EMERGENCY LOCKDOWN ACTIVE. Forcing door lock!")
        return False
    return bool(state.get("unlocked", False))


# ── Main Application Loop ──────────────────────────────────
# Move servo first so wiring problems are obvious even before WiFi
servo_boot_wiggle()
connect_wifi()

current_unlocked_state = None
last_assert_t = 0

print("Pico SG90 Servo Controller started")
print("Backend:", BACKEND_URL)

while True:
    if not wlan.isconnected():
        print("WiFi lost! Reconnecting...")
        connect_wifi()
        time.sleep(2)
        continue

    unlocked = check_door_status()
    now = time.ticks_ms()

    if unlocked is None:
        print("Backend unreachable. Retrying...")
        blink_led(4, 0.12)
        time.sleep(POLL_INTERVAL_S)
        continue

    state_changed = unlocked != current_unlocked_state
    need_reassert = (
        unlocked
        and current_unlocked_state is True
        and time.ticks_diff(now, last_assert_t) > int(REASSERT_EVERY_S * 1000)
    )

    if state_changed or need_reassert:
        if unlocked:
            print("System unlocked. Servo -> OPEN")
            set_servo(DUTY_UNLOCKED, hold_s=1.2, keep_signal=True)
            if led:
                led.on()
        else:
            print("System locked. Servo -> CLOSED")
            set_servo(DUTY_LOCKED, hold_s=1.2, keep_signal=False)
            if led:
                led.off()
        current_unlocked_state = unlocked
        last_assert_t = now

    if not unlocked and led:
        led.on()
        time.sleep(0.1)
        led.off()
        time.sleep(max(0.0, POLL_INTERVAL_S - 0.1))
    else:
        time.sleep(POLL_INTERVAL_S)
