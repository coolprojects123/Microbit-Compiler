#include "MicroBit.h"

MicroBit uBit;

int main() {
    uBit.init();
    int count = 0;

    while (true) {
        if (uBit.buttonA.isPressed()) {
            count++;
            uBit.display.print(count);
            uBit.sleep(200);
        }

        if (uBit.buttonB.isPressed()) {
            count = 0;
            uBit.display.print(count);
            uBit.sleep(200);
        }
    }
}
