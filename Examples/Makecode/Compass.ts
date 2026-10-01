let heading = 0

basic.forever(function () {
    heading = input.compassHeading()
    if (heading < 45 || heading >= 315) {
        basic.showString("N")
    } else if (heading < 135) {
        basic.showString("E")
    } else if (heading < 225) {
        basic.showString("S")
    } else {
        basic.showString("W")
    }
    basic.pause(200)
})
