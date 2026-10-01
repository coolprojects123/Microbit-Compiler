from microbit import *

compass.calibrate()

while True:
    heading = compass.heading()
    display.scroll(str(heading))
    sleep(200)
