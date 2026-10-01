#include "MicroBit.h"

MicroBit uBit;

int main() {
    uBit.init();

    while (true) {
        int heading = uBit.compass.heading();
        if (heading < 45 || heading >= 315) {
            uBit.display.print('N');
        } else if (heading < 135) {
            uBit.display.print('E');
        } else if (heading < 225) {
            uBit.display.print('S');
        } else {
            uBit.display.print('W');
        }
        uBit.sleep(200);
    }
}
