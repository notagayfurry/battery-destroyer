// gpu_stress.swift
// Metal GPU stress test for Apple Silicon Macs.
// Runs heavy compute shaders in a tight loop to maximize GPU power draw.
//
// Compile: swiftc gpu_stress.swift -framework Metal -framework CoreGraphics -o gpu_stress

import Foundation
import Metal

// Metal compute shader that performs heavy floating-point operations
let shaderSource = """
#include <metal_stdlib>
using namespace metal;

kernel void stress(
    device float4 *buffer [[buffer(0)]],
    uint id [[thread_position_in_grid]]
) {
    float4 val = buffer[id];
    // Heavy math loop - each thread does thousands of FP ops
    for (int i = 0; i < 4096; i++) {
        val = sin(val) * cos(val) + tan(val * 0.999);
        val = sqrt(abs(val)) + log(abs(val) + 1.0);
        val = val * val - val * 0.5 + float4(0.1, 0.2, 0.3, 0.4);
        val = fma(val, float4(3.14159), float4(2.71828));
        val = rsqrt(abs(val) + 0.001) * val;
    }
    buffer[id] = val;
}
"""

guard let device = MTLCreateSystemDefaultDevice() else {
    fputs("Error: Metal is not supported on this device\n", stderr)
    exit(1)
}

fputs("GPU stress: using \(device.name)\n", stderr)

// Compile the shader
let library: MTLLibrary
do {
    library = try device.makeLibrary(source: shaderSource, options: nil)
} catch {
    fputs("Error compiling shader: \(error)\n", stderr)
    exit(1)
}

guard let function = library.makeFunction(name: "stress") else {
    fputs("Error: could not find kernel function\n", stderr)
    exit(1)
}

let pipelineState: MTLComputePipelineState
do {
    pipelineState = try device.makeComputePipelineState(function: function)
} catch {
    fputs("Error creating pipeline state: \(error)\n", stderr)
    exit(1)
}

// Allocate a large buffer to stress the GPU
// 16MB of float4 data = 1M float4 elements
let elementCount = 1024 * 1024
let bufferSize = elementCount * MemoryLayout<SIMD4<Float>>.size

guard let metalBuffer = device.makeBuffer(length: bufferSize, options: .storageModeShared) else {
    fputs("Error: could not allocate Metal buffer\n", stderr)
    exit(1)
}

// Initialize buffer with random data
let ptr = metalBuffer.contents().bindMemory(to: SIMD4<Float>.self, capacity: elementCount)
for i in 0..<elementCount {
    ptr[i] = SIMD4<Float>(
        Float.random(in: 0.1...10.0),
        Float.random(in: 0.1...10.0),
        Float.random(in: 0.1...10.0),
        Float.random(in: 0.1...10.0)
    )
}

guard let commandQueue = device.makeCommandQueue() else {
    fputs("Error: could not create command queue\n", stderr)
    exit(1)
}

let threadGroupSize = MTLSize(width: pipelineState.maxTotalThreadsPerThreadgroup, height: 1, depth: 1)
let threadGroups = MTLSize(width: (elementCount + threadGroupSize.width - 1) / threadGroupSize.width, height: 1, depth: 1)

// Handle SIGTERM/SIGINT for clean shutdown
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

fputs("GPU stress: running...\n", stderr)

// Main stress loop - submit compute work as fast as possible
while true {
    guard let commandBuffer = commandQueue.makeCommandBuffer(),
          let encoder = commandBuffer.makeComputeCommandEncoder() else {
        continue
    }

    encoder.setComputePipelineState(pipelineState)
    encoder.setBuffer(metalBuffer, offset: 0, index: 0)
    encoder.dispatchThreadgroups(threadGroups, threadsPerThreadgroup: threadGroupSize)
    encoder.endEncoding()

    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
}
