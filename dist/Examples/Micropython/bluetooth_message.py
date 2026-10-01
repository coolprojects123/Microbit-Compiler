from microbit import *

while True:
    if button_a.was_pressed():
        uart.write('Hello from micro:bit!\n')
        display.show(Image.HAPPY)
        sleep(200)
    else:
        display.show(Image.HEART)
        sleep(200)
