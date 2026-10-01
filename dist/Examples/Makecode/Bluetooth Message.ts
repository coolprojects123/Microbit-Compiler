bluetooth.onBluetoothConnected(function () {
    basic.showIcon(IconNames.Happy)
})

bluetooth.onBluetoothDisconnected(function () {
    basic.showIcon(IconNames.Sad)
})

input.onButtonPressed(Button.A, function () {
    bluetooth.uartWriteString("Hello from micro:bit!\n")
    basic.showString("A")
})
