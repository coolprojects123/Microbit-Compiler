from microbit import *

while True:
    temp = temperature()
    if temp > 30:
        display.show(Image.SAD)
    else:
        display.show(Image.HAPPY)
    sleep(500)
