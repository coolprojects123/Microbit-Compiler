radio.setGroup(1)

input.onButtonPressed(Button.A, function () {
    radio.sendString("ping")
    basic.showString("P")
})

radio.onReceivedString(function (receivedString) {
    basic.showString(receivedString)
})
