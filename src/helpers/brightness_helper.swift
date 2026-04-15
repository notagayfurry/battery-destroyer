// brightness_helper.swift
// Uses the private DisplayServices framework to get/set brightness on macOS.
// The public `brightness` CLI tool is broken on Apple Silicon + Sequoia.
//
// Compile: swiftc brightness_helper.swift -framework CoreGraphics -F /System/Library/PrivateFrameworks -framework DisplayServices -o brightness_helper

import Foundation
import CoreGraphics

@_silgen_name("DisplayServicesGetBrightness")
func DisplayServicesGetBrightness(_ display: UInt32, _ brightness: UnsafeMutablePointer<Float>) -> Int32

@_silgen_name("DisplayServicesSetBrightness")
func DisplayServicesSetBrightness(_ display: UInt32, _ brightness: Float) -> Int32

let args = CommandLine.arguments
let mainDisplay = CGMainDisplayID()

if args.count < 2 || args[1] == "get" {
    var brightness: Float = 0
    let result = DisplayServicesGetBrightness(mainDisplay, &brightness)
    if result == 0 {
        print(String(format: "%.6f", brightness))
    } else {
        fputs("Error: could not get brightness (code \(result))\n", stderr)
        exit(1)
    }
} else if args[1] == "set" {
    guard args.count >= 3, let value = Float(args[2]) else {
        fputs("Usage: brightness_helper set <0.0-1.0>\n", stderr)
        exit(1)
    }
    let clamped = max(0.0, min(1.0, value))
    let result = DisplayServicesSetBrightness(mainDisplay, clamped)
    if result != 0 {
        fputs("Error: could not set brightness (code \(result))\n", stderr)
        exit(1)
    }
} else {
    fputs("Usage: brightness_helper [get|set <value>]\n", stderr)
    exit(1)
}
