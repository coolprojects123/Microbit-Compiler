from microbit import *
import radio

radio.on()
radio.config(group=1)

while True:
    if button_a.was_pressed():
        radio.send('ping')
        display.show('P')
    incoming = radio.receive()
    if incoming is not None:
        display.show(incoming)
    sleep(100)
