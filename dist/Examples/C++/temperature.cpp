#include "MicroBit.h"

MicroBit uBit;

int main() {
    uBit.init();

    while (true) {
        int temp = uBit.temperature();
        if (temp > 30) {
            uBit.display.print("S");
        } else {
            uBit.display.print("H");
        }
        uBit.sleep(500);
    }
}
