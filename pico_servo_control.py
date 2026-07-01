# pico_servo_control.py
# MicroPython script for Raspberry Pi Pico W
# 
# Wiring Instructions:
#   SG90 Servo Motor:
#     - Orange/Yellow (PWM/Signal) -> GP15 (Pin 20)
#     - Red (Power VCC) -> VBUS (Pin 40, 5V) or 3V3 (Pin 36, 3.3V)
#     - Black/Brown (GND) -> GND (Any Ground Pin, e.g. Pin 38)
#
# Upload this file to your Raspberry Pi Pico W as main.py to run on boot.

import network
import urequests
import time
from machine import Pin, PWM

# ── Configuration ──────────────────────────────────────────
WIFI_SSID = "David H."
WIFI_PASSWORD = "henriquez"
BACKEND_URL = "http://172.20.10.2:8000"  # Laptop IP address

SERVO_PIN = 15  # GPIO pin connected to SG90 Signal wire (GP15)

# Servo PWM settings
# SG90 runs at 50Hz (20ms period). 
# Duty cycles (duty_u16 range is 0 to 65535):
#   - 0 degrees (locked):   ~0.5ms pulse width -> (0.5 / 20) * 65535 = 1638
#   - 90 degrees (unlocked): ~1.5ms pulse width -> (1.5 / 20) * 65535 = 4915
DUTY_INITIAL = 1638   # Reverted/Locked position (0 degrees)
DUTY_UNLOCKED = 4915  # Active/Unlocked position (90 degrees)

# ── Hardware Setup ──────────────────────────────────────────
pwm = PWM(Pin(SERVO_PIN))
pwm.freq(50)

# Initialize servo position
pwm.duty_u16(DUTY_INITIAL)
time.sleep(0.5)
pwm.duty_u16(0)  # Turn off pulse output to prevent servo jitter

# Onboard LED Setup for Visual Debugging
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

# ── WiFi Connection ─────────────────────────────────────────
wlan = network.WLAN(network.STA_IF)

def connect_wifi():
    print("📡 Activating WiFi...")
    wlan.active(True)
    if not wlan.isconnected():
        print("Connecting to network:", WIFI_SSID)
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        
        # Wait for connection with timeout
        timeout = 20
        while not wlan.isconnected() and timeout > 0:
            print("Waiting for connection...", timeout)
            blink_led(2, 0.1)  # Blink LED rapidly while connecting
            time.sleep(0.8)
            timeout -= 1
            
    if wlan.isconnected():
        print("✓ Connected to WiFi!")
        print("IP Address:", wlan.ifconfig()[0])
        if led:
            led.on()
    else:
        print("✗ WiFi connection failed!")
        if led:
            led.off()

# ── Servo Control ───────────────────────────────────────────
def set_servo_position(duty):
    pwm.duty_u16(duty)
    time.sleep(0.6)  # Give the physical servo time to rotate
    pwm.duty_u16(0)  # Cut pulse output to stop hum/jitter and save power

# ── Backend Queries ─────────────────────────────────────────
def check_door_status():
    """
    Fetches emergency lockdown and door state from the backend.
    Returns:
        True if a door is unlocked and emergency lockdown is inactive.
        False if locked, or emergency lockdown is active.
        None if a connection/request error occurs.
    """
    # 1. Query emergency lockdown status
    try:
        res = urequests.get(f"{BACKEND_URL}/api/emergency/status", timeout=5)
        state = res.json()
        res.close()
        
        if state.get("emergency_lock", False):
            print("🚨 EMERGENCY LOCKDOWN ACTIVE. Forcing door lock!")
            return False
            
    except Exception as e:
        print("⚠️ Error querying emergency status:", e)
        return None  # Connection error

    # 2. Query doors status
    try:
        res = urequests.get(f"{BACKEND_URL}/api/doors/", timeout=5)
        doors = res.json()
        res.close()
        
        # If any door in the system is unlocked, return True (unlock servo)
        for door in doors:
            if not door.get("locked", True):
                print(f"🔓 Door '{door.get('room_name')}' is unlocked.")
                return True
                
    except Exception as e:
        print("⚠️ Error querying door status:", e)
        return None  # Connection error
        
    return False

# ── Main Application Loop ──────────────────────────────────
connect_wifi()
current_unlocked_state = None

print("🚀 Pico SG90 Servo Controller loop started...")

while True:
    # 1. Ensure WiFi is connected
    if not wlan.isconnected():
        print("📶 WiFi lost! Reconnecting...")
        connect_wifi()
        time.sleep(2)
        continue
        
    # 2. Check door status from backend
    unlocked = check_door_status()
    
    # 3. Handle connection/request errors (unlocked is None)
    if unlocked is None:
        print("❌ Backend unreachable. Locking door for safety.")
        # Revert servo to locked position for safety
        if current_unlocked_state is not False:
            set_servo_position(DUTY_INITIAL)
            current_unlocked_state = False
        
        # Blink LED rapidly to signal network error
        blink_led(6, 0.15)
        time.sleep(1)
        continue
        
    # 4. Handle successful state updates
    if unlocked != current_unlocked_state:
        if unlocked:
            print("🔓 System unlocked. Turning servo to 90°...")
            set_servo_position(DUTY_UNLOCKED)
            if led:
                led.on()  # Solid LED for unlocked state
        else:
            print("🔒 System locked / Grace period ended. Reverting servo to 0°...")
            set_servo_position(DUTY_INITIAL)
            if led:
                led.off()  # LED off for locked state
        current_unlocked_state = unlocked
        
    # 5. Slow blink when connected and locked to show active status
    if not unlocked and led:
        led.on()
        time.sleep(0.1)
        led.off()
        time.sleep(1.9)
    else:
        time.sleep(2)
