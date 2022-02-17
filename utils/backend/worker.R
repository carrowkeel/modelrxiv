library('jsonlite')
library('modules')

run_params <- function(params, fixed_params, variable_params) {
	step_module <- modules::use(script)
	results <- vector('list', nrow(variable_params))
	for(i in 1:nrow(variable_params)) {
		results[[i]] <- step_module$run(merge(fixed_params, variable_params[i,]))
	}
	return(results)
}

process_job <- function(request) {
	result <- run_params(request$script, request$fixed_params, request$variable_params)
	return(result)
}

main <- function() {
	f <- file('stdin')
	open(f, blocking=TRUE)
	while(length(line <- readLines(f,n=1)) > 0) {
		message <- fromJSON(line)
		if(message$type != 'job') {
			continue
		}
		output <- {}
		output$type <- 'result'
		output$result <- process_job(message$request)
		write(paste(toJSON(output, auto_unbox=TRUE), '\n', sep=''), stdout())
	}
}

main()
