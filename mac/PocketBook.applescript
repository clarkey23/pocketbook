on run
	set projectDir to (POSIX path of (path to home folder)) & "Library/Application Support/PocketBook"
	set pythonBin to projectDir & "/venv/bin/python"
	set scriptPath to projectDir & "/pocketbook.py"
	set statusPath to projectDir & "/status.txt"
	set logPath to projectDir & "/last-run.log"
	
	try
		set theLink to text returned of (display dialog "Paste a Project Gutenberg link:" & return & return & "Long books can take a few minutes. You'll see progress while it works." default answer "" with title "PocketBook" buttons {"Cancel", "Make booklet"} default button "Make booklet")
	on error number -128
		return
	end try
	
	set theLink to trim(theLink)
	if theLink is "" then
		display alert "PocketBook" message "No link provided." as critical
		return
	end if
	
	if not (do shell script "test -x " & quoted form of pythonBin & " && echo ok || echo missing") is "ok" then
		display alert "PocketBook" message "Setup is incomplete. Open Cursor and ask to reinstall PocketBook." as critical
		return
	end if
	
	do shell script "rm -f " & quoted form of statusPath & " " & quoted form of logPath
	
	set progress total steps to 6
	set progress completed steps to 0
	set progress description to "Making pocket booklet"
	set progress additional description to "Starting…"
	
	set cmd to "cd " & quoted form of projectDir & " && " & quoted form of pythonBin & " -u " & quoted form of scriptPath & " " & quoted form of theLink & " > " & quoted form of logPath & " 2>&1; echo EXIT:$? >> " & quoted form of logPath
	set pid to do shell script cmd & " & echo $!"
	
	set pdfPath to ""
	set failed to false
	set failMsg to "Conversion failed."
	repeat
		delay 0.4
		try
			set statusLine to do shell script "cat " & quoted form of statusPath
			set AppleScript's text item delimiters to "|"
			set parts to text items of statusLine
			set AppleScript's text item delimiters to ""
			if (count of parts) ≥ 2 then
				set stageToken to item 1 of parts
				set stageMsg to item 2 of parts
				set AppleScript's text item delimiters to "/"
				set stageBits to text items of stageToken
				set AppleScript's text item delimiters to ""
				try
					set stageNum to (item 1 of stageBits) as number
					if stageNum ≥ 0 and stageNum ≤ 6 then
						set progress completed steps to stageNum
					end if
				end try
				set progress additional description to stageMsg
			end if
		end try
		
		try
			set stillRunning to do shell script "kill -0 " & pid & " 2>/dev/null && echo 1 || echo 0"
		on error
			set stillRunning to "0"
		end try
		
		if stillRunning is "0" then
			exit repeat
		end if
	end repeat
	
	-- Read result from log
	try
		set logText to do shell script "cat " & quoted form of logPath
		set exitCode to "1"
		repeat with aLine in paragraphs of logText
			if aLine starts with "EXIT:" then
				set exitCode to text 6 thru -1 of aLine
			end if
			if aLine starts with "Booklet ready: " then
				set pdfPath to text 16 thru -1 of aLine
			end if
			if aLine starts with "Error: " then
				set failMsg to text 8 thru -1 of aLine
			end if
		end repeat
		if exitCode is not "0" then set failed to true
	on error errMsg
		set failed to true
		set failMsg to errMsg
	end try
	
	set progress completed steps to 6
	delay 0.2
	set progress total steps to 0
	
	if failed or pdfPath is "" then
		display alert "PocketBook failed" message failMsg as critical
		return
	end if
	
	do shell script "open " & quoted form of pdfPath
	display notification "Saved to Downloads" with title "PocketBook"
end run

on trim(s)
	set s to s as text
	repeat while s starts with " " or s starts with tab
		if length of s is 1 then return ""
		set s to text 2 thru -1 of s
	end repeat
	repeat while s ends with " " or s ends with tab
		if length of s is 1 then return ""
		set s to text 1 thru -2 of s
	end repeat
	return s
end trim

