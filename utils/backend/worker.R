library('jsonlite')
library('modules')

run_dynamics <- function(script, params) {
	step_module <- modules::use(script)
	steps <- max(1, params$target_steps)
	step <- NULL
	for(t in 0:steps) {
		step <- step_module$step(params, step, t)
		write(paste(toJSON(step, auto_unbox=TRUE)), stderr())
	}
	return(step)
}

run_params <- function(script, fixed_params, variable_params) {
	step_module <- modules::use(script)
	results <- vector('list', nrow(variable_params))
	for(i in 0:nrow(variable_params)) {
		results[[i]] <- step_module$run(modifyList(fixed_params, as.list(variable_params[i,,drop=FALSE])))
	}
	return(results)
}

test <- function(script) {
	step_module <- modules::use(script)
	params <- step_module$defaults()
	if(any(names(step_module) == 'step')) {
		return(list(
			input_params=params,
			dynamics_params=step_module$step(params, FALSE, 0),
			result_params=step_module$run(params)
		))
	} else {
		return(list(
			input_params=params,
			dynamics_params=list(),
			result_params=step_module$run(params)
		))
	}
}

process_job <- function(request) {
	if(!any(names(request) == 'variable_params')) {
		return(run_dynamics(request$script, request$fixed_params))
	} else if(any(names(request$fixed_params) == 'test')) {
		return(test(request$script))
	} else {
		return(run_params(request$script, request$fixed_params, request$variable_params))
	}
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
		write(paste(toJSON(output, auto_unbox=TRUE)), stdout())
	}
}

main()

##dynamics_test <- function() {
##	params <- list(n=10, P=0.5, L=1.01, N=100, target_steps=100)
##	return(run_dynamics('test.R', params))
##}

##dynamics_test()
