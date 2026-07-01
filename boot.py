import network
import time
import machine

print("--- LabSecure AI Pico W Startup ---")

# Connect to Wi-Fi
SSID = "David H."
PASSWORD = "henriquez"

wlan = network.WLAN(network.STA_IF)
wlan.active(True)

print("Connecting to Wi-Fi:", SSID)
wlan.connect(SSID, PASSWORD)

# Wait for connection with a 15-second timeout
timeout = 15
while timeout > 0:
    if wlan.isconnected():
        break
    time.sleep(1)
    timeout -= 1
    print(".", end="")

print()
if wlan.isconnected():
    print("Connected successfully!")
    print("IP Address Info:", wlan.ifconfig())
    # Turn on onboard LED to show connected status
    try:
        led = machine.Pin("LED", machine.Pin.OUT)
        led.on()
    except Exception:
        pass
else:
    print("Failed to connect to Wi-Fi.")
    # Blink LED fast to show failure
    try:
        led = machine.Pin("LED", machine.Pin.OUT)
        for _ in range(10):
            led.toggle()
            time.sleep(0.1)
    except Exception:
        pass
