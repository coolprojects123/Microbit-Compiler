#include "MicroBit.h"

MicroBit uBit;

int main() {
    uBit.init();

    while (true) {
        if (uBit.buttonA.isPressed()) {
            uBit.display.print("A");
            uBit.serial.send(ManagedString("Hello from micro:bit!\n"));
            uBit.sleep(200);
        }

        if (uBit.buttonB.isPressed()) {
            uBit.display.clear();
            uBit.sleep(200);
        }
    }
}
