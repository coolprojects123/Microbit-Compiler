basic.forever(function () {
    let temp = input.temperature()
    if (temp > 30) {
        basic.showIcon(IconNames.Sad)
    } else {
        basic.showIcon(IconNames.Happy)
    }
    basic.pause(500)
})
