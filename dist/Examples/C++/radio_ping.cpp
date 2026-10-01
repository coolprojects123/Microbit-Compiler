#include "MicroBit.h"

MicroBit uBit;

int main() {
    uBit.init();
    uBit.radio.enable();
    uBit.radio.setGroup(1);

    while (true) {
        if (uBit.buttonA.isPressed()) {
            uBit.display.print('P');
            uBit.radio.datagram.send("ping");
            uBit.sleep(200);
        }

        if (uBit.radio.datagramReceived()) {
            PacketBuffer packet = uBit.radio.datagram.recv();
            uBit.display.scroll((char*)packet.rawData);
        }
    }
}
