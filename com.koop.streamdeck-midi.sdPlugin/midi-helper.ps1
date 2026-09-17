$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class WinMidi {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MIDIOUTCAPS {
        public ushort wMid; public ushort wPid; public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
        public ushort wTechnology; public ushort wVoices; public ushort wNotes;
        public ushort wChannelMask; public uint dwSupport;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MIDIHDR {
        public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded;
        public IntPtr dwUser; public uint dwFlags; public IntPtr lpNext;
        public IntPtr reserved; public uint dwOffset;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)] public IntPtr[] dwReserved;
    }

    [DllImport("winmm.dll")] public static extern uint midiOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern uint midiOutGetDevCaps(UIntPtr deviceId, out MIDIOUTCAPS caps, uint capsSize);
    [DllImport("winmm.dll")] public static extern uint midiOutOpen(out IntPtr handle, uint deviceId, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] public static extern uint midiOutShortMsg(IntPtr handle, uint message);
    [DllImport("winmm.dll")] public static extern uint midiOutPrepareHeader(IntPtr handle, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] public static extern uint midiOutLongMsg(IntPtr handle, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] public static extern uint midiOutUnprepareHeader(IntPtr handle, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] public static extern uint midiOutReset(IntPtr handle);
    [DllImport("winmm.dll")] public static extern uint midiOutClose(IntPtr handle);

    private const uint MHDR_DONE = 0x00000001;

    public static uint SendLong(IntPtr handle, byte[] bytes) {
        IntPtr data = IntPtr.Zero;
        IntPtr headerPtr = IntPtr.Zero;
        uint headerSize = (uint)Marshal.SizeOf(typeof(MIDIHDR));
        bool prepared = false;
        try {
            data = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, data, bytes.Length);
            MIDIHDR header = new MIDIHDR {
                lpData = data, dwBufferLength = (uint)bytes.Length,
                dwBytesRecorded = (uint)bytes.Length, dwReserved = new IntPtr[8]
            };
            headerPtr = Marshal.AllocHGlobal((int)headerSize);
            Marshal.StructureToPtr(header, headerPtr, false);
            uint result = midiOutPrepareHeader(handle, headerPtr, headerSize);
            if (result != 0) return result;
            prepared = true;
            result = midiOutLongMsg(handle, headerPtr, headerSize);
            if (result != 0) return result;
            for (int i = 0; i < 500; i++) {
                MIDIHDR current = (MIDIHDR)Marshal.PtrToStructure(headerPtr, typeof(MIDIHDR));
                if ((current.dwFlags & MHDR_DONE) != 0) return 0;
                Thread.Sleep(10);
            }
            midiOutReset(handle);
            return 1460;
        } finally {
            if (prepared && headerPtr != IntPtr.Zero) midiOutUnprepareHeader(handle, headerPtr, headerSize);
            if (headerPtr != IntPtr.Zero) Marshal.FreeHGlobal(headerPtr);
            if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
        }
    }
}
'@

$openPorts = @{}

function Get-MidiPorts {
    $ports = @()
    $count = [WinMidi]::midiOutGetNumDevs()
    for ($i = 0; $i -lt $count; $i++) {
        $caps = New-Object WinMidi+MIDIOUTCAPS
        $result = [WinMidi]::midiOutGetDevCaps([UIntPtr]$i, [ref]$caps, [Runtime.InteropServices.Marshal]::SizeOf($caps))
        if ($result -eq 0) { $ports += [PSCustomObject]@{ id = $i; name = $caps.szPname } }
    }
    return @($ports)
}

function Write-Reply($reply) {
    [Console]::Out.WriteLine(($reply | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}

function Get-OpenPort([string]$name) {
    $match = @(Get-MidiPorts | Where-Object { $_.name -eq $name } | Select-Object -First 1)
    if ($match.Count -eq 0) { throw "MIDI output '$name' was not found." }
    $deviceId = [uint32]$match[0].id
    $key = [string]$deviceId
    if (-not $openPorts.ContainsKey($key)) {
        $handle = [IntPtr]::Zero
        $result = [WinMidi]::midiOutOpen([ref]$handle, $deviceId, [IntPtr]::Zero, [IntPtr]::Zero, 0)
        if ($result -ne 0) { throw "Could not open MIDI output (Windows MIDI error $result)." }
        $openPorts[$key] = $handle
    }
    return $openPorts[$key]
}

try {
    while (($line = [Console]::In.ReadLine()) -ne $null) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $request = $null
        try {
            $request = $line | ConvertFrom-Json
            if ($request.cmd -eq 'ports') {
                $names = @(Get-MidiPorts | ForEach-Object { $_.name })
                Write-Reply @{ id = $request.id; ok = $true; result = @{ ports = $names } }
                continue
            }
            if ($request.cmd -eq 'send') {
                $bytes = @($request.bytes | ForEach-Object { [byte]$_ })
                if ($bytes.Count -lt 1) { throw 'MIDI message is empty.' }
                $handle = Get-OpenPort ([string]$request.port)
                if ($bytes[0] -eq 0xF0) {
                    if ($bytes[$bytes.Count - 1] -ne 0xF7) { throw 'SysEx message must end with F7.' }
                    $result = [WinMidi]::SendLong($handle, [byte[]]$bytes)
                } else {
                    if ($bytes.Count -gt 3) { throw 'A non-SysEx MIDI message cannot exceed 3 bytes.' }
                    $message = [uint32]0
                    for ($i = 0; $i -lt $bytes.Count; $i++) { $message = $message -bor (([uint32]$bytes[$i]) -shl (8 * $i)) }
                    $result = [WinMidi]::midiOutShortMsg($handle, $message)
                }
                if ($result -ne 0) { throw "Could not send MIDI message (Windows MIDI error $result)." }
                Write-Reply @{ id = $request.id; ok = $true }
                continue
            }
            throw "Unknown MIDI helper command '$($request.cmd)'."
        } catch {
            $replyId = if ($null -ne $request) { $request.id } else { 0 }
            Write-Reply @{ id = $replyId; ok = $false; error = $_.Exception.Message }
        }
    }
} finally {
    foreach ($handle in $openPorts.Values) {
        [void][WinMidi]::midiOutReset($handle)
        [void][WinMidi]::midiOutClose($handle)
    }
}
