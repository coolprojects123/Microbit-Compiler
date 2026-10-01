from microbit import *

count = 0

while True:
    if button_a.is_pressed():
        count += 1
        display.show(str(count))
        sleep(200)
    if button_b.is_pressed():
        count = 0
        display.show(str(count))
        sleep(200)
